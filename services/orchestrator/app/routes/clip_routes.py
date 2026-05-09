"""文稿剪辑：工程、上传、豆包录音文件识别 2.0 转写、词级排除与 ffmpeg 导出。"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from .. import auth_bridge
from ..clip_audio_merge import clip_merge_limits, ffprobe_audio_channels
from ..clip_merge_scheduler import merge_immediate
from ..clip_segment_transcript import (
    parse_audio_source_segments,
    parse_segment_transcript_cache,
    stitch_cached_segment_transcripts,
)
from ..clip_audio_repair import (
    repair_ambient_to_mp3,
    repair_dual_stereo_balance_to_mp3,
    repair_voice_clarity_to_mp3,
    repair_loudnorm_to_mp3,
    sniff_suffix_from_filename,
)
from ..clip_export import resolve_export_loudnorm_i_lufs
from ..clip_store import (
    append_clip_audio_source_segment,
    prepend_current_main_as_source_segment_if_empty_sources,
    append_clip_suggestion_feedback,
    append_collaboration_note,
    append_retake_take_slot,
    append_studio_snapshot,
    clear_clip_project_audio_material_completely,
    delete_clip_project,
    reorder_clip_audio_staging,
    get_clip_project,
    insert_clip_project,
    list_clip_projects,
    prune_clip_audio_segment_transcripts,
    remove_clip_audio_source_segment_from_list,
    reorder_clip_audio_source_segments,
    reorder_clip_audio_staging,
    rename_clip_audio_source_segment,
    replace_clip_source_audio_preserve_transcript,
    replace_retake_manifest,
    revert_clip_export_after_enqueue_failed,
    revert_clip_transcription_after_enqueue_failed,
    try_claim_clip_export_queued,
    try_claim_clip_transcription_queued,
    update_clip_excluded_words,
    update_clip_export_pause_policy,
    update_clip_asr_corpus,
    update_clip_rough_cut_lexicon_exempt,
    update_clip_project_audio,
    update_clip_project_meta,
    update_clip_repair_loudness_i_lufs,
    update_clip_silence_analysis,
    update_clip_timeline_json,
    update_qc_report,
    update_clip_transcript_normalized_only,
    clear_clip_merged_main_audio_when_using_segments,
)
from ..clip_loudness_qc import analyze_loudness_from_file
from ..clip_timeline import build_timeline_v1_from_row
from ..clip_timeline_audio import concat_ordered_source_segments_to_bytes
from ..models import resolved_user_uuid_string
from ..clip_silence_detect import detect_silence_segments_from_file
from ..object_store import (
    delete_object_key,
    get_object_bytes,
    head_object_byte_length,
    iter_object_byte_range,
    iter_object_chunks,
    presigned_get_url,
    upload_bytes,
)
from ..queue import ai_queue
from ..security import verify_internal_signature
from ..share_publish_llm import (
    clip_transcript_words_to_script_raw,
    generate_share_rss_ai_copy,
    refine_share_show_notes_with_prompt,
)
from ..volcengine_seed_asr_client import volc_seed_auth_configured
from ..worker_tasks import run_clip_audio_events_job, run_clip_export_job, run_clip_transcription_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["clip"], dependencies=[Depends(verify_internal_signature)])

_CLIP_MAX_BYTES = max(1024 * 1024, int(os.getenv("CLIP_MAX_UPLOAD_BYTES") or str(200 * 1024 * 1024)))
_CLIP_STAGE_MAX_BYTES = max(
    1024 * 1024, min(_CLIP_MAX_BYTES, int(os.getenv("CLIP_STAGE_MAX_UPLOAD_BYTES") or str(100 * 1024 * 1024)))
)
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._\-]+")


def _clip_filename_from_header(value: str | None, default: str) -> str:
    """BFF 与浏览器对 x-clip-filename 使用 UTF-8 百分号编码，此处解码后再做对象键安全化。"""
    raw = (value or default).strip() or default
    try:
        return unquote(raw, encoding="utf-8", errors="replace")
    except TypeError:
        return unquote(raw)


def _staging_entries_from_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    st = row.get("audio_staging_keys")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return []
    out: list[dict[str, Any]] = []
    for it in st:
        if isinstance(it, dict) and str(it.get("key") or "").strip():
            out.append(it)
    return out


def _source_segments_from_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    st = row.get("audio_source_segments")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return []
    out: list[dict[str, Any]] = []
    for it in st:
        if isinstance(it, dict) and str(it.get("key") or "").strip():
            out.append(it)
    return out


def _material_audio_keys_from_row(row: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for s in _source_segments_from_row(row):
        k = str(s.get("key") or "").strip()
        if k:
            keys.add(k)
    for s in _staging_entries_from_row(row):
        k = str(s.get("key") or "").strip()
        if k:
            keys.add(k)
    mk = str(row.get("audio_object_key") or "").strip()
    if mk:
        keys.add(mk)
    return keys


def _segment_filename_mime_for_key(row: dict[str, Any], object_key: str) -> tuple[str, str]:
    for s in _source_segments_from_row(row) + _staging_entries_from_row(row):
        if str(s.get("key") or "").strip() == object_key:
            return (
                str(s.get("filename") or "segment.mp3")[:500],
                str(s.get("mime") or "application/octet-stream").strip()[:200],
            )
    return (
        str(row.get("audio_filename") or "audio.mp3")[:500],
        str(row.get("audio_mime") or "application/octet-stream").strip()[:200],
    )


def _clip_stream_audio_object(
    request: Request,
    *,
    object_key: str,
    filename_hint: str,
    mime_raw: str,
) -> StreamingResponse | Response:
    media_type = _effective_audio_media_type(filename_hint, mime_raw)
    try:
        total = head_object_byte_length(object_key)
    except Exception as exc:
        logger.warning("clip audio head_object failed key_tail=%s err=%s", object_key[-48:], exc)
        raise HTTPException(status_code=503, detail=f"读取音频元数据失败: {exc}") from exc
    if total <= 0:
        raise HTTPException(status_code=400, detail="音频长度为 0")

    range_hdr = (request.headers.get("range") or request.headers.get("Range") or "").strip()
    br = _parse_single_byte_range(range_hdr, total)
    cache = "private, max-age=60"
    if br:
        start, end = br
        if start >= total:
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{total}"},
            )
        part_len = end - start + 1
        return StreamingResponse(
            iter_object_byte_range(object_key, start, end),
            media_type=media_type,
            status_code=206,
            headers={
                "Content-Length": str(part_len),
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Accept-Ranges": "bytes",
                "Cache-Control": cache,
            },
        )

    return StreamingResponse(
        iter_object_chunks(object_key),
        media_type=media_type,
        headers={
            "Content-Length": str(total),
            "Accept-Ranges": "bytes",
            "Cache-Control": cache,
        },
    )


def _material_segments_from_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    """合并顺序：持久化分段 + 兼容旧版仅暂存 staging。"""
    src = _source_segments_from_row(row)
    stg = _staging_entries_from_row(row)
    if src and stg:
        return [*src, *stg]
    if src:
        return src
    return stg


def _clip_retime_transcript_after_segments_change(*, project_id: str, uid: str | None) -> None:
    """
    方案三：分段顺序/列表变化后，用 audio_segment_transcripts 缓存重拼 transcript_normalized；
    并丢弃合并主轨 object key（编辑期以分段为真源）。
    """
    clear_clip_merged_main_audio_when_using_segments(project_id=project_id, user_uuid=uid)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        return
    if str(row.get("transcription_status") or "").strip() != "succeeded":
        return
    segments = parse_audio_source_segments(row)
    if len(segments) < 1:
        return
    cache = parse_segment_transcript_cache(row)
    merged = stitch_cached_segment_transcripts(segments, cache)
    if merged is None:
        logger.info(
            "clip retime_transcript_skip stitch incomplete project_id=%s segments=%s",
            project_id,
            len(segments),
        )
        return
    update_clip_transcript_normalized_only(
        project_id=project_id, user_uuid=uid, normalized=merged
    )


async def _clip_run_audio_merge_for_project(*, project_id: str, uid: str | None) -> dict[str, Any]:
    """上传/删段/手动 merge：即时合并主轨并返回最新工程。"""
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    staging = _material_segments_from_row(row)
    if not staging:
        raise HTTPException(status_code=400, detail="暂无待合并的分段素材")
    try:
        await merge_immediate(project_id, uid)
    except Exception as exc:
        logger.exception("clip merge immediate failed project_id=%s", project_id)
        raise HTTPException(status_code=400, detail=str(exc)[:800]) from exc
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return _serialize_clip_row(row2 or {})


def _current_user_ref_or_401(request: Request) -> str | None:
    if not auth_bridge.is_auth_enabled():
        return None
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    ref = auth_bridge.session_principal(sess)
    if not ref:
        raise HTTPException(status_code=401, detail="未登录")
    return ref


def _owner_uuid(request: Request) -> str | None:
    ref = _current_user_ref_or_401(request)
    if not ref:
        return None
    return resolved_user_uuid_string(ref)


def _apply_channel_ids_from_audio_file(*, project_id: str, user_uuid: str | None, file_path: Path) -> None:
    """根据 ffprobe 声道数写入 channel_ids（≥2 视为双轨访谈）。"""
    try:
        n = ffprobe_audio_channels(file_path)
        ch = [0, 1] if n >= 2 else [0]
        update_clip_project_meta(project_id=project_id, user_uuid=user_uuid, channel_ids=ch)
        logger.info("clip audio channel_autodetect project_id=%s channels=%s channel_ids=%s", project_id, n, ch)
    except Exception as exc:
        logger.warning("clip audio channel_autodetect_skip project_id=%s err=%s", project_id, exc)


def _effective_audio_media_type(filename: str, mime_header: str) -> str:
    """上传头常为 application/octet-stream；<audio>/WebAudio 需要可信的 audio/*。"""
    m = (mime_header or "").strip().lower()
    if m and m not in ("application/octet-stream", "binary/octet-stream", "") and not m.startswith("text/"):
        return (mime_header or "").strip()[:200]
    fn = (filename or "").strip().lower()
    if fn.endswith(".mp3"):
        return "audio/mpeg"
    if fn.endswith(".wav"):
        return "audio/wav"
    if fn.endswith(".m4a") or fn.endswith(".mp4"):
        return "audio/mp4"
    if fn.endswith(".aac"):
        return "audio/aac"
    if fn.endswith(".flac"):
        return "audio/flac"
    if fn.endswith(".ogg") or fn.endswith(".opus"):
        return "audio/ogg"
    if fn.endswith(".webm"):
        return "audio/webm"
    return "audio/mpeg"


def _parse_single_byte_range(range_header: str | None, total: int) -> tuple[int, int] | None:
    """解析 ``Range: bytes=a-b`` 单区间，返回 (start, end_inclusive)；不支持的格式返回 None。"""
    if total <= 0 or not range_header:
        return None
    rh = range_header.strip()
    if not rh.lower().startswith("bytes="):
        return None
    spec = rh.split("=", 1)[1].strip().split(",", 1)[0].strip()
    if "-" not in spec:
        return None
    left, _, right = spec.partition("-")
    try:
        if left == "":
            if not right.isdigit():
                return None
            ln = int(right)
            if ln <= 0:
                return None
            start = max(0, total - ln)
            end = total - 1
        else:
            start = int(left)
            if start < 0 or start >= total:
                return None
            end = int(right) if right != "" else total - 1
    except ValueError:
        return None
    end = min(end, total - 1)
    if start > end:
        return None
    return start, end


def _clip_words_and_excluded_for_share(row: dict[str, Any]) -> tuple[list[dict[str, Any]], frozenset[str]]:
    norm = row.get("transcript_normalized")
    if isinstance(norm, str) and norm.strip():
        try:
            norm = json.loads(norm)
        except Exception:
            norm = {}
    words: list[dict[str, Any]] = []
    if isinstance(norm, dict):
        wl = norm.get("words") or []
        if isinstance(wl, list):
            words = [w for w in wl if isinstance(w, dict)]
    ex_raw = row.get("excluded_word_ids") or []
    if isinstance(ex_raw, str) and ex_raw.strip():
        try:
            ex_raw = json.loads(ex_raw)
        except Exception:
            ex_raw = []
    excluded: set[str] = set()
    if isinstance(ex_raw, list):
        for x in ex_raw:
            s = str(x).strip()
            if s:
                excluded.add(s)
    return words, frozenset(excluded)


def _serialize_clip_row(row: dict[str, Any]) -> dict[str, Any]:
    d = dict(row)
    for k in ("created_at", "updated_at"):
        v = d.get(k)
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    for k in ("user_id", "id"):
        v = d.get(k)
        if v is not None:
            d[k] = str(v)
    # JSONB may already be dict/list
    for key in (
        "transcript_raw_json",
        "transcript_normalized",
        "excluded_word_ids",
        "channel_ids",
        "audio_staging_keys",
        "audio_source_segments",
        "suggestion_feedback",
        "silence_analysis",
        "timeline_json",
        "studio_snapshots",
        "collaboration_notes",
        "retake_manifest",
        "qc_report",
        "export_pause_policy",
        "rough_cut_lexicon_exempt",
        "asr_corpus_hotwords",
        "asr_corpus_scene",
    ):
        if isinstance(d.get(key), str):
            try:
                d[key] = json.loads(d[key])
            except Exception:
                pass
    stg = d.get("audio_staging_keys")
    d["audio_staging_count"] = len(stg) if isinstance(stg, list) else 0
    src_seg = d.get("audio_source_segments")
    d["audio_source_segments_count"] = len(src_seg) if isinstance(src_seg, list) else 0
    stc = d.get("audio_segment_transcripts")
    if isinstance(stc, str) and stc.strip():
        try:
            stc = json.loads(stc)
        except Exception:
            stc = {}
    d["segment_transcripts_cached_count"] = len(stc) if isinstance(stc, dict) else 0
    d.pop("audio_segment_transcripts", None)
    d["clip_merge_limits"] = clip_merge_limits()
    d["clip_asr_provider"] = "volc_seed"
    src_seg = d.get("audio_source_segments")
    n_src = len(src_seg) if isinstance(src_seg, list) else 0
    d["has_audio"] = bool(str(d.get("audio_object_key") or "").strip()) or n_src > 0
    if d.get("audio_object_key"):
        try:
            d["audio_download_url"] = presigned_get_url(str(d["audio_object_key"]), expires_in=3600)
        except Exception:
            d["audio_download_url"] = None
    else:
        d["audio_download_url"] = None
    if d.get("export_object_key") and str(d.get("export_status") or "") == "succeeded":
        try:
            d["export_download_url"] = presigned_get_url(str(d["export_object_key"]), expires_in=3600)
        except Exception:
            d["export_download_url"] = None
    else:
        d["export_download_url"] = None
    d.setdefault("audio_merge_status", "idle")
    d.setdefault("audio_merge_error", None)
    return d


def _silence_cut_ranges_from_timeline_doc(doc: Any) -> list[tuple[int, int, int]]:
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except Exception:
            doc = None
    if not isinstance(doc, dict):
        return []
    raw = doc.get("silence_cuts")
    if not isinstance(raw, list):
        return []
    out: list[tuple[int, int, int]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        try:
            s = int(it.get("start_ms"))
            e = int(it.get("end_ms"))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        try:
            cap = int(it.get("cap_ms")) if it.get("cap_ms") is not None else 0
        except (TypeError, ValueError):
            cap = 0
        out.append((s, e, max(0, min(10_000, cap))))
    return out


def _audio_event_cut_ranges_from_timeline_doc(doc: Any) -> list[tuple[int, int, int]]:
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except Exception:
            doc = None
    if not isinstance(doc, dict):
        return []
    raw = doc.get("audio_events")
    if not isinstance(raw, list):
        return []
    out: list[tuple[int, int, int]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        action = str(it.get("action") or "keep").strip().lower()
        if action != "cut":
            continue
        try:
            s = int(it.get("start_ms"))
            e = int(it.get("end_ms"))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        out.append((s, e, 0))
    return out


def _audio_event_duck_ranges_from_timeline_doc(doc: Any) -> list[tuple[int, int]]:
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except Exception:
            doc = None
    if not isinstance(doc, dict):
        return []
    raw = doc.get("audio_events")
    if not isinstance(raw, list):
        return []
    out: list[tuple[int, int]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        action = str(it.get("action") or "keep").strip().lower()
        if action != "duck":
            continue
        try:
            s = int(it.get("start_ms"))
            e = int(it.get("end_ms"))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        out.append((s, e))
    return out


@router.post("/clip/projects")
def clip_create_project(request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    uid = _owner_uuid(request)
    if auth_bridge.is_auth_enabled():
        if not uid:
            raise HTTPException(
                status_code=400,
                detail="当前登录未关联到用户库 UUID，无法创建剪辑工程。请重新登录或联系管理员同步账户。",
            )
    title = str((body or {}).get("title") or "未命名剪辑").strip() or "未命名剪辑"
    pid = insert_clip_project(user_uuid=uid, title=title[:200])
    row = get_clip_project(project_id=pid, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row or {})}


@router.get("/clip/projects")
def clip_list_projects(request: Request, limit: int = 50):
    uid = _owner_uuid(request)
    rows = list_clip_projects(user_uuid=uid, limit=limit)
    return {"success": True, "projects": [_serialize_clip_row(dict(r)) for r in rows]}


@router.get("/clip/projects/{project_id}")
def clip_get_project(project_id: str, request: Request):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    return {"success": True, "project": _serialize_clip_row(row)}


@router.post("/clip/projects/{project_id}/share-ai-copy")
def clip_share_ai_copy(project_id: str, request: Request, body: dict[str, Any] | None = Body(default=None)):
    """
    与 POST /jobs/{job_id}/share-ai-copy 对齐：
    - 默认：generate_share_rss_ai_copy；
    - show_notes_only=true：refine_share_show_notes_with_prompt（须含 user_prompt）。
    script_raw 均由当前工程转写词（剔除已删词）拼接。
    """
    opts = body if isinstance(body, dict) else {}
    notes_only = bool(opts.get("show_notes_only"))
    user_prompt = str(opts.get("user_prompt") or "").strip()
    baseline_show_notes = str(opts.get("baseline_show_notes") or "").strip()

    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    if str(row.get("transcription_status") or "").strip().lower() != "succeeded":
        raise HTTPException(status_code=400, detail="transcription_not_succeeded")

    words, excluded = _clip_words_and_excluded_for_share(row)
    script_raw = clip_transcript_words_to_script_raw(words, excluded_ids=excluded)
    if not script_raw.strip():
        raise HTTPException(status_code=400, detail="no_script_for_ai_copy")

    title_hint = str(row.get("title") or "").strip()[:300]
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None

    if notes_only:
        if not user_prompt:
            raise HTTPException(status_code=400, detail="user_prompt_required")
        try:
            pack = refine_share_show_notes_with_prompt(
                script_raw=script_raw,
                user_source_text="",
                chapter_timeline_hint="",
                baseline_show_notes=baseline_show_notes,
                user_prompt=user_prompt,
                api_key=api_key,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)[:200]) from exc
        except Exception as exc:
            logger.warning("clip_share_ai_copy refine failed project_id=%s err=%s", project_id, exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)[:500]) from exc
    else:
        try:
            pack = generate_share_rss_ai_copy(
                script_raw=script_raw,
                user_source_text="",
                episode_title_hint=title_hint,
                chapter_timeline_hint="",
                api_key=api_key,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)[:200]) from exc
        except Exception as exc:
            logger.warning("clip_share_ai_copy failed project_id=%s err=%s", project_id, exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)[:500]) from exc

    summary_out = str(pack.get("summary") or "").strip()
    show_notes_out = str(pack.get("show_notes") or "").strip()
    return {
        "success": True,
        "summary": summary_out,
        "show_notes": show_notes_out,
        "trace_id": pack.get("trace_id"),
    }


@router.patch("/clip/projects/{project_id}")
@router.post("/clip/projects/{project_id}")
def clip_patch_project(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    b = body or {}
    if "excluded_word_ids" in b:
        ex = b.get("excluded_word_ids")
        if not isinstance(ex, list):
            raise HTTPException(status_code=400, detail="excluded_word_ids 须为数组")
        update_clip_excluded_words(project_id=project_id, user_uuid=uid, word_ids=[str(x) for x in ex])
    if "export_pause_policy" in b:
        pol = b.get("export_pause_policy")
        if pol is not None and not isinstance(pol, dict):
            raise HTTPException(status_code=400, detail="export_pause_policy 须为对象或 null")
        clean_pol: dict[str, Any] | None = None
        if pol is None:
            clean_pol = None
        elif isinstance(pol, dict) and bool(pol.get("enabled")):
            try:
                long_gap_ms = int(pol.get("long_gap_ms", 2000))
                cap_ms = int(pol.get("cap_ms", 500))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="export_pause_policy 数值无效") from None
            clean_pol = {
                "enabled": True,
                "long_gap_ms": max(500, min(120_000, long_gap_ms)),
                "cap_ms": max(100, min(5000, cap_ms)),
            }
        else:
            clean_pol = None
        if not update_clip_export_pause_policy(project_id=project_id, user_uuid=uid, policy=clean_pol):
            raise HTTPException(status_code=500, detail="无法更新导出停顿策略")
    if "rough_cut_lexicon_exempt" in b:
        raw_ex = b.get("rough_cut_lexicon_exempt")
        if not isinstance(raw_ex, list):
            raise HTTPException(status_code=400, detail="rough_cut_lexicon_exempt 须为字符串数组")
        phrases: list[str] = []
        for x in raw_ex:
            s = str(x).strip()[:64]
            if s:
                phrases.append(s)
            if len(phrases) >= 200:
                break
        if not update_clip_rough_cut_lexicon_exempt(project_id=project_id, user_uuid=uid, phrases=phrases):
            raise HTTPException(status_code=500, detail="无法更新口癖豁免词表")
    if "asr_corpus_hotwords" in b or "asr_corpus_scene" in b:
        raw_hw = b.get("asr_corpus_hotwords", row.get("asr_corpus_hotwords"))
        if isinstance(raw_hw, str):
            try:
                raw_hw = json.loads(raw_hw)
            except Exception:
                raw_hw = []
        if raw_hw is None:
            raw_hw = []
        if not isinstance(raw_hw, list):
            raise HTTPException(status_code=400, detail="asr_corpus_hotwords 须为字符串数组")
        hw_list: list[str] = []
        seen_hw: set[str] = set()
        for x in raw_hw:
            s = str(x).strip()[:48]
            if not s or s in seen_hw:
                continue
            seen_hw.add(s)
            hw_list.append(s)
            if len(hw_list) >= 500:
                break
        sc_src = b["asr_corpus_scene"] if "asr_corpus_scene" in b else row.get("asr_corpus_scene")
        if sc_src is not None and not isinstance(sc_src, str):
            raise HTTPException(status_code=400, detail="asr_corpus_scene 须为字符串或 null")
        sc_clean = (str(sc_src).strip()[:3500] if sc_src is not None else None) or None
        if not update_clip_asr_corpus(
            project_id=project_id, user_uuid=uid, hotwords=hw_list, scene=sc_clean
        ):
            raise HTTPException(status_code=500, detail="无法更新 ASR 语料配置")
    if "repair_loudness_i_lufs" in b:
        raw_l = b.get("repair_loudness_i_lufs")
        if raw_l is None:
            ok_l = update_clip_repair_loudness_i_lufs(project_id=project_id, user_uuid=uid, i_lufs=None)
        else:
            try:
                v = float(raw_l)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="repair_loudness_i_lufs 须为数字或 null") from None
            if not math.isfinite(v) or v < -24.0 or v > -10.0:
                raise HTTPException(status_code=400, detail="repair_loudness_i_lufs 须在 -24～-10 LUFS 之间") from None
            ok_l = update_clip_repair_loudness_i_lufs(project_id=project_id, user_uuid=uid, i_lufs=v)
        if not ok_l:
            raise HTTPException(status_code=500, detail="无法更新响度目标")
    ch_ids: list[int] | None = None
    if "channel_ids" in b:
        ch = b.get("channel_ids")
        if not isinstance(ch, list):
            raise HTTPException(status_code=400, detail="channel_ids 须为数组")
        ch_ids = []
        for x in ch:
            try:
                ch_ids.append(int(x))
            except (TypeError, ValueError):
                continue
        if not ch_ids:
            raise HTTPException(status_code=400, detail="channel_ids 不能为空")
    spk: int | None = None
    if "speaker_count" in b:
        try:
            spk = max(1, min(8, int(b.get("speaker_count"))))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="speaker_count 无效")
    title_up: str | None = None
    if "title" in b:
        title_up = str(b.get("title") or "").strip()[:200] or "未命名剪辑"
    update_clip_project_meta(
        project_id=project_id,
        user_uuid=uid,
        title=title_up,
        diarization_enabled=bool(b["diarization_enabled"]) if "diarization_enabled" in b else None,
        speaker_count=spk,
        channel_ids=ch_ids,
    )
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/audio")
async def clip_upload_audio(project_id: str, request: Request):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    body = await request.body()
    if not body or len(body) > _CLIP_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"音频过大或为空（上限 {_CLIP_MAX_BYTES} 字节）")
    fn_display = _clip_filename_from_header(request.headers.get("x-clip-filename"), "upload.mp3").strip()[:500]
    if not fn_display:
        fn_display = "upload.mp3"
    base_name = Path(fn_display).name[:240] or "upload.mp3"
    ext = Path(base_name).suffix[:12] or ".mp3"
    safe_stem = _SAFE_NAME.sub("_", Path(base_name).stem).strip("._")[:120] or "upload"
    mime_raw = (request.headers.get("x-clip-mime") or "application/octet-stream").strip()[:120]
    mime = _effective_audio_media_type(fn_display, mime_raw)
    owner_seg = uid or "anon"
    key = f"clip/{owner_seg}/{project_id}/source_{uuid.uuid4().hex[:12]}_{safe_stem}{ext}"
    upload_bytes(key, body, mime)
    ok = update_clip_project_audio(
        project_id=project_id,
        user_uuid=uid,
        object_key=key,
        filename=fn_display,
        mime=mime,
        size_bytes=len(body),
    )
    if not ok:
        delete_object_key(key)
        raise HTTPException(status_code=500, detail="更新工程音频字段失败")
    try:
        suf = Path(fn_display).suffix or ".bin"
        with tempfile.NamedTemporaryFile(prefix="fyv_clip_probe_", suffix=suf, delete=True) as tf:
            tf.write(body)
            tf.flush()
            _apply_channel_ids_from_audio_file(project_id=project_id, user_uuid=uid, file_path=Path(tf.name))
    except Exception:
        logger.exception("clip upload ffprobe channel_detect failed project_id=%s", project_id)
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/audio/repair")
async def clip_repair_source_audio(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """主素材修音：环境音（高通 + afftdn + 可选人声轻增强 + 限幅）、立体声左右电平自动平衡、或 EBU R128 loudnorm；保留转写稿。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    b = body or {}
    kind = str(b.get("kind") or "").strip().lower()
    if kind not in ("ambient", "loudnorm", "dual_balance", "voice_clarity"):
        raise HTTPException(status_code=400, detail="kind 须为 ambient、loudnorm、dual_balance 或 voice_clarity")
    t_st = str(row.get("transcription_status") or "").strip()
    if t_st in ("running", "queued"):
        raise HTTPException(status_code=409, detail="转写进行中，请稍后再试修音")
    old_key = str(row.get("audio_object_key") or "").strip()
    segs_rep = parse_audio_source_segments(row)
    if not old_key:
        if segs_rep:
            raise HTTPException(
                status_code=400,
                detail="多段未合并主轨时暂不支持修音；请先调用「合并主轨」接口或单段素材后再试。",
            )
        raise HTTPException(status_code=400, detail="无主素材音频")
    owner_seg = uid or "anon"
    try:
        raw = get_object_bytes(old_key)
    except Exception as exc:
        logger.exception("clip repair download failed project_id=%s", project_id)
        raise HTTPException(status_code=502, detail="读取素材失败") from exc
    if not raw or len(raw) < 64:
        raise HTTPException(status_code=400, detail="素材过短或为空")
    fn = str(row.get("audio_filename") or "source.mp3")
    suf = sniff_suffix_from_filename(fn)
    new_key: str | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="fyv_clip_repair_") as td:
            td_path = Path(td)
            src = td_path / f"in{suf}"
            src.write_bytes(raw)
            out_mp3 = td_path / "repaired.mp3"
            if kind == "ambient":
                repair_ambient_to_mp3(src, out_mp3)
            elif kind == "voice_clarity":
                repair_voice_clarity_to_mp3(src, out_mp3)
            elif kind == "dual_balance":
                repair_dual_stereo_balance_to_mp3(src, out_mp3)
            else:
                i_lufs = resolve_export_loudnorm_i_lufs(row.get("repair_loudness_i_lufs"))
                repair_loudnorm_to_mp3(src, out_mp3, i_lufs=i_lufs)
            out_bytes = out_mp3.read_bytes()
        new_key = f"clip/{owner_seg}/{project_id}/repair_{uuid.uuid4().hex[:12]}.mp3"
        upload_bytes(new_key, out_bytes, "audio/mpeg")
        ok = replace_clip_source_audio_preserve_transcript(
            project_id=project_id,
            user_uuid=uid,
            object_key=new_key,
            filename=(Path(fn).stem or "source") + "_repaired.mp3",
            mime="audio/mpeg",
            size_bytes=len(out_bytes),
        )
        if not ok:
            delete_object_key(new_key)
            raise HTTPException(status_code=500, detail="写入修音结果失败")
        if old_key != new_key:
            delete_object_key(old_key)
    except HTTPException:
        if new_key:
            delete_object_key(new_key)
        raise
    except Exception as exc:
        if new_key:
            delete_object_key(new_key)
        logger.exception("clip repair failed project_id=%s kind=%s", project_id, kind)
        raise HTTPException(status_code=400, detail=str(exc)[:800]) from exc
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/audio/stage")
async def clip_stage_audio_segment(project_id: str, request: Request):
    """追加一段分段素材（写对象存储 + DB）。

    同步路径主要耗时：整包读入内存、对象存储上传、DB 更新；若工程已转写成功还会做稿面重拼
    （``_clip_retime_transcript_after_segments_change``）。多文件可并行请求以缩短总等待。
    """
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    body = await request.body()
    if not body or len(body) > _CLIP_STAGE_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"单段过大或为空（单段上限 {_CLIP_STAGE_MAX_BYTES // (1024 * 1024)}MB，且须符合录音识别产品总大小限制）",
        )
    fn_display = _clip_filename_from_header(request.headers.get("x-clip-filename"), "segment.mp3").strip()[:500]
    if not fn_display:
        fn_display = "segment.mp3"
    base_name = Path(fn_display).name[:240] or "segment.mp3"
    safe_tail = _SAFE_NAME.sub("_", base_name).strip("._")[:120] or "segment"
    mime_raw = (request.headers.get("x-clip-mime") or "application/octet-stream").strip()[:120]
    mime = _effective_audio_media_type(fn_display, mime_raw)
    owner_seg = uid or "anon"
    sk = f"clip/{owner_seg}/{project_id}/stage_{uuid.uuid4().hex[:16]}_{safe_tail}"
    upload_bytes(sk, body, mime)
    main_key = str(row.get("audio_object_key") or "").strip()
    if main_key and not _source_segments_from_row(row) and not _staging_entries_from_row(row):
        prepend_current_main_as_source_segment_if_empty_sources(
            project_id=project_id,
            user_uuid=uid,
            main_key=main_key,
            filename=str(row.get("audio_filename") or "main.mp3")[:500],
            mime=str(row.get("audio_mime") or "audio/mpeg")[:200],
            size_bytes=int(row.get("audio_size_bytes") or 0),
        )
    ok = append_clip_audio_source_segment(
        project_id=project_id,
        user_uuid=uid,
        object_key=sk,
        filename=fn_display,
        mime=mime,
        size_bytes=len(body),
    )
    if not ok:
        delete_object_key(sk)
        raise HTTPException(status_code=400, detail="无法追加分段（可能超过段数上限）")
    _clip_retime_transcript_after_segments_change(project_id=project_id, uid=uid)
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/audio/staging/reorder")
async def clip_reorder_staged_audio(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """调整分段顺序（audio_source_segments：重拼稿面；旧版 staging：仍自动合并主轨）。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    b = body or {}
    raw_keys = b.get("staging_keys")
    if not isinstance(raw_keys, list) or not raw_keys:
        raise HTTPException(status_code=400, detail="staging_keys 须为非空字符串数组")
    ordered = [str(x).strip() for x in raw_keys if str(x).strip()]
    if not ordered:
        raise HTTPException(status_code=400, detail="staging_keys 无效")
    if _source_segments_from_row(row):
        ok = reorder_clip_audio_source_segments(project_id=project_id, user_uuid=uid, ordered_keys=ordered)
    elif _staging_entries_from_row(row):
        ok = reorder_clip_audio_staging(project_id=project_id, user_uuid=uid, ordered_keys=ordered)
    else:
        raise HTTPException(status_code=400, detail="当前无可重排的分段")
    if not ok:
        raise HTTPException(status_code=400, detail="无法重排：与当前分段 key 集合不一致")
    row_mid = get_clip_project(project_id=project_id, user_uuid=uid) or {}
    if _source_segments_from_row(row_mid):
        _clip_retime_transcript_after_segments_change(project_id=project_id, uid=uid)
    else:
        await merge_immediate(project_id, uid)
    row_out = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row_out or {})}


@router.post("/clip/projects/{project_id}/audio/source-segment/rename")
def clip_rename_audio_source_segment(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """仅更新某分段的展示文件名（object_key 不变）。"""
    uid = _owner_uuid(request)
    b = body or {}
    key = str(b.get("object_key") or "").strip()
    fn = str(b.get("filename") or "").strip()
    if not key or not fn:
        raise HTTPException(status_code=400, detail="object_key 与 filename 均不能为空")
    ok = rename_clip_audio_source_segment(
        project_id=project_id, user_uuid=uid, object_key=key, filename=fn[:500]
    )
    if not ok:
        raise HTTPException(status_code=400, detail="未找到对应分段或无法更新")
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/audio/source-segment/remove")
async def clip_remove_audio_source_segment(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """删除一分段对象并更新列表；若仍有多段则自动再合并主音。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    b = body or {}
    key = str(b.get("object_key") or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="object_key 不能为空")
    segs = _source_segments_from_row(row)
    cur_keys = {str(s.get("key") or "").strip() for s in segs}
    if key not in cur_keys:
        raise HTTPException(status_code=404, detail="分段不存在")
    old_main = str(row.get("audio_object_key") or "").strip() or None
    if len(segs) <= 1:
        delete_object_key(key)
        if old_main:
            delete_object_key(old_main)
        clear_clip_project_audio_material_completely(project_id=project_id, user_uuid=uid)
        row2 = get_clip_project(project_id=project_id, user_uuid=uid)
        return {"success": True, "project": _serialize_clip_row(row2 or {})}
    ok, new_list = remove_clip_audio_source_segment_from_list(project_id=project_id, user_uuid=uid, object_key=key)
    if not ok:
        raise HTTPException(status_code=500, detail="无法更新分段列表")
    delete_object_key(key)
    prune_clip_audio_segment_transcripts(
        project_id=project_id,
        user_uuid=uid,
        keep_keys=[str(s.get("key") or "").strip() for s in new_list if str(s.get("key") or "").strip()],
    )
    _clip_retime_transcript_after_segments_change(project_id=project_id, uid=uid)
    row_out = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row_out or {})}


@router.post("/clip/projects/{project_id}/audio/merge")
async def clip_merge_staged_audio(project_id: str, request: Request):
    """将当前分段合并为单轨主音频（同源可走无损拼接；否则转 AAC/m4a）；保留各段对象键。"""
    uid = _owner_uuid(request)
    serialized = await _clip_run_audio_merge_for_project(project_id=project_id, uid=uid)
    return {"success": True, "project": serialized}


@router.get("/clip/projects/{project_id}/audio/file")
def clip_get_project_audio_file(project_id: str, request: Request):
    """同源波形/试听：经 BFF 代理；补充 Content-Length、Range/206，避免浏览器无法解码或无法 seek。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    key = str(row.get("audio_object_key") or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="无音频")
    fn = str(row.get("audio_filename") or "")
    mime_raw = str(row.get("audio_mime") or "application/octet-stream").strip()[:200]
    return _clip_stream_audio_object(request, object_key=key, filename_hint=fn, mime_raw=mime_raw)


@router.get("/clip/projects/{project_id}/audio/source-segment/file")
def clip_get_source_segment_audio_file(
    project_id: str,
    request: Request,
    object_key: str = Query("", description="分段素材 object_key，须属于当前工程"),
):
    """试听单段素材（与主音频同一鉴权与 Range 语义）。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    qk = (object_key or "").strip()
    if not qk:
        raise HTTPException(status_code=400, detail="缺少 object_key")
    if qk not in _material_audio_keys_from_row(row):
        raise HTTPException(status_code=404, detail="无权访问该分段或 key 无效")
    fn, mime_raw = _segment_filename_mime_for_key(row, qk)
    return _clip_stream_audio_object(request, object_key=qk, filename_hint=fn, mime_raw=mime_raw)


def _wordchain_preview_object_key(owner_seg: str, project_id: str) -> str:
    return f"clip/{owner_seg}/{project_id}/wordchain_preview.mp3"


@router.post("/clip/projects/{project_id}/audio/wordchain-preview")
def clip_post_wordchain_preview(project_id: str, request: Request):
    """生成与终版导出相同的词链 MP3（含 export_pause_policy），写入对象存储供波形试听；不替换主素材。"""
    from ..clip_export import export_clip_mp3_from_bytes

    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    if str(row.get("transcription_status") or "").strip() != "succeeded":
        raise HTTPException(status_code=400, detail="转写未完成，无法生成试听")
    segs_wc = parse_audio_source_segments(row)
    audio_key = str(row.get("audio_object_key") or "").strip()
    if not audio_key and len(segs_wc) < 1:
        raise HTTPException(status_code=400, detail="无主素材音频")
    norm = row.get("transcript_normalized")
    if isinstance(norm, str):
        try:
            norm = json.loads(norm)
        except Exception:
            norm = {}
    if not isinstance(norm, dict):
        raise HTTPException(status_code=400, detail="缺少归一化文稿")
    ex = row.get("excluded_word_ids")
    if isinstance(ex, str):
        try:
            ex = json.loads(ex)
        except Exception:
            ex = []
    excluded = {str(x) for x in (ex if isinstance(ex, list) else [])}
    try:
        merge_gap_ms = max(0, int(os.getenv("CLIP_EXPORT_MERGE_GAP_MS") or "120"))
    except (TypeError, ValueError):
        merge_gap_ms = 120
    pol_raw = row.get("export_pause_policy")
    if isinstance(pol_raw, str):
        try:
            pol_raw = json.loads(pol_raw)
        except Exception:
            pol_raw = None
    long_pause_ms = 0
    long_pause_cap_ms = 500
    if isinstance(pol_raw, dict) and bool(pol_raw.get("enabled")):
        try:
            long_pause_ms = max(0, int(pol_raw.get("long_gap_ms", 2000)))
            long_pause_cap_ms = max(50, min(5000, int(pol_raw.get("cap_ms", 500))))
        except (TypeError, ValueError):
            long_pause_ms, long_pause_cap_ms = 0, 500
    owner_seg = uid or "anon"
    pk = _wordchain_preview_object_key(owner_seg, project_id)
    tl_doc = row.get("timeline_json")
    silence_cuts = _silence_cut_ranges_from_timeline_doc(tl_doc)
    try:
        if segs_wc:
            raw = concat_ordered_source_segments_to_bytes(segs_wc)
        else:
            raw = get_object_bytes(audio_key)
        out = export_clip_mp3_from_bytes(
            audio_bytes=raw,
            normalized=norm,
            excluded_word_ids=excluded,
            merge_gap_ms=merge_gap_ms,
            long_pause_ms=long_pause_ms,
            long_pause_cap_ms=long_pause_cap_ms,
            silence_cut_ranges=silence_cuts,
            duck_ranges=None,
            loudnorm_i_lufs=resolve_export_loudnorm_i_lufs(row.get("repair_loudness_i_lufs")),
        )
    except Exception as exc:
        logger.warning("clip wordchain_preview build failed project_id=%s err=%s", project_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)[:800]) from exc
    upload_bytes(pk, out, "audio/mpeg")
    return {"success": True, "object_key": pk}


@router.get("/clip/projects/{project_id}/audio/wordchain-preview")
def clip_get_wordchain_preview(project_id: str, request: Request):
    """流式返回 POST 生成的词链试听 MP3（支持 Range）。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    owner_seg = uid or "anon"
    key = _wordchain_preview_object_key(owner_seg, project_id)
    media_type = "audio/mpeg"
    try:
        total = head_object_byte_length(key)
    except Exception:
        raise HTTPException(
            status_code=404,
            detail="尚无试听文件，请先在「缩短停顿」侧栏点击生成词链试听",
        ) from None
    if total <= 0:
        raise HTTPException(status_code=400, detail="试听文件无效")

    range_hdr = (request.headers.get("range") or request.headers.get("Range") or "").strip()
    br = _parse_single_byte_range(range_hdr, total)
    cache = "private, no-store"
    if br:
        start, end = br
        if start >= total:
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{total}"},
            )
        part_len = end - start + 1
        return StreamingResponse(
            iter_object_byte_range(key, start, end),
            media_type=media_type,
            status_code=206,
            headers={
                "Content-Length": str(part_len),
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Accept-Ranges": "bytes",
                "Cache-Control": cache,
            },
        )

    return StreamingResponse(
        iter_object_chunks(key),
        media_type=media_type,
        headers={
            "Content-Length": str(total),
            "Accept-Ranges": "bytes",
            "Cache-Control": cache,
        },
    )


@router.post("/clip/projects/{project_id}/edit-suggestions")
def clip_post_edit_suggestions(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """调用 TEXT_PROVIDER（默认 DeepSeek）：带 word_id 的 TSV 输入 + 结构化 action，服务端校验后返回。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    if not bool((body or {}).get("llm")):
        return {"success": True, "items": [], "source": "none"}
    from ..clip_suggestions_llm import clip_edit_suggestions_from_row

    try:
        items = clip_edit_suggestions_from_row(row, body or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:400]) from exc
    except Exception as exc:
        logger.warning("clip edit-suggestions llm failed project_id=%s err=%s", project_id, exc)
        raise HTTPException(status_code=503, detail=str(exc)[:500]) from exc
    mode = str((body or {}).get("mode") or "structured").strip().lower()
    src = "llm_outline" if mode == "outline" else "llm_expand" if mode == "expand" else "llm_structured"
    return {"success": True, "items": items, "source": src}


@router.post("/clip/projects/{project_id}/verbal-suggestion-review")
def clip_post_verbal_suggestion_review(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """对前端规则生成的可执行建议（exclude / keep_stutter_first）走与 edit-suggestions 相同的 LLM 轻量复核。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    from ..clip_suggestions_llm import _words_from_normalized, light_review_verbal_suggestion_items

    raw_items = (body or {}).get("items")
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=400, detail="items 须为 JSON 数组")
    words = _words_from_normalized(row.get("transcript_normalized"))

    norm: list[dict[str, Any]] = []
    for it in raw_items[:24]:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()[:200]
        body_t = str(it.get("body") or "").strip()[:800]
        action = str(it.get("action") or "").strip().lower()
        wid_raw = it.get("word_ids") if isinstance(it.get("word_ids"), list) else it.get("wordIds")
        raw_ids: list[str] = []
        if isinstance(wid_raw, list):
            for x in wid_raw[:120]:
                s = str(x).strip()
                if s:
                    raw_ids.append(s)
        raw_ids = list(dict.fromkeys(raw_ids))
        if action == "exclude_word_ids" and raw_ids:
            norm.append({"title": title, "body": body_t, "action": "exclude_word_ids", "word_ids": raw_ids})
        elif action == "keep_stutter_first" and len(raw_ids) >= 2:
            norm.append({"title": title, "body": body_t, "action": "keep_stutter_first", "word_ids": raw_ids})

    if not norm:
        return {"success": True, "items": []}

    if not words:
        return {"success": True, "items": norm}

    try:
        reviewed = light_review_verbal_suggestion_items(norm, words=words)
    except Exception as exc:
        logger.warning("verbal-suggestion-review failed project_id=%s err=%s", project_id, exc)
        raise HTTPException(status_code=503, detail=str(exc)[:500]) from exc
    return {"success": True, "items": reviewed}


@router.get("/clip/projects/{project_id}/silences")
def clip_get_project_silences(project_id: str, request: Request):
    """ffmpeg silencedetect；结果缓存于 silence_analysis（随主音频 object_key 失效）。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    key = str(row.get("audio_object_key") or "").strip()
    segs_sd = parse_audio_source_segments(row)
    cache_key = key or "|".join(str(s.get("key") or "").strip() for s in segs_sd)
    if not cache_key:
        raise HTTPException(status_code=400, detail="无音频")
    sa = row.get("silence_analysis")
    if isinstance(sa, str):
        try:
            sa = json.loads(sa)
        except Exception:
            sa = None
    if isinstance(sa, dict) and str(sa.get("object_key") or "").strip() == cache_key:
        segs = sa.get("segments")
        if isinstance(segs, list) and segs:
            return {"success": True, "segments": segs, "cached": True}
    try:
        if key:
            raw = get_object_bytes(key)
            suf = Path(str(row.get("audio_filename") or "clip.bin")).suffix or ".bin"
        elif segs_sd:
            raw = concat_ordered_source_segments_to_bytes(segs_sd)
            suf = ".m4a"
        else:
            raise HTTPException(status_code=400, detail="无音频")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"读取音频失败: {exc}") from exc
    if not raw or len(raw) < 32:
        raise HTTPException(status_code=400, detail="音频数据无效")
    try:
        with tempfile.NamedTemporaryFile(prefix="fyv_clip_sd_", suffix=suf, delete=True) as tf:
            tf.write(raw)
            tf.flush()
            segs = detect_silence_segments_from_file(Path(tf.name))
    except Exception as exc:
        logger.warning("clip silence_detect failed project_id=%s err=%s", project_id, exc)
        raise HTTPException(status_code=503, detail=str(exc)[:500]) from exc
    analysis = {"object_key": cache_key, "segments": segs}
    update_clip_silence_analysis(project_id=project_id, user_uuid=uid, analysis=analysis)
    return {"success": True, "segments": segs, "cached": False}


@router.post("/clip/projects/{project_id}/suggestion-feedback")
def clip_post_suggestion_feedback(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    """记录建议执行/撤销等事件，供后续反哺词表与 prompt。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    ev = body.get("event") if isinstance(body.get("event"), dict) else body
    if not isinstance(ev, dict) or not str(ev.get("kind") or "").strip():
        raise HTTPException(status_code=400, detail="event 须为对象且含 kind")
    ok = append_clip_suggestion_feedback(project_id=project_id, user_uuid=uid, event=ev)
    if not ok:
        raise HTTPException(status_code=500, detail="写入反馈失败")
    return {"success": True}


def _clip_parse_jsonb(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return None
    return value


@router.get("/clip/projects/{project_id}/studio")
def clip_get_studio_bundle(project_id: str, request: Request):
    """精剪时间线、快照、协作备注、重录清单（与 GET project 字段一致，便于独立拉取）。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    timeline_stored = _clip_parse_jsonb(row.get("timeline_json"))
    derived = build_timeline_v1_from_row(row)
    if isinstance(timeline_stored, dict) and isinstance(timeline_stored.get("tracks"), list):
        timeline_effective = timeline_stored
    else:
        timeline_effective = derived
    return {
        "success": True,
        "timeline_stored": timeline_stored if isinstance(timeline_stored, dict) else None,
        "timeline_derived": derived,
        "timeline_effective": timeline_effective,
        "studio_snapshots": _clip_parse_jsonb(row.get("studio_snapshots")) or [],
        "collaboration_notes": _clip_parse_jsonb(row.get("collaboration_notes")) or [],
        "retake_manifest": _clip_parse_jsonb(row.get("retake_manifest")) or [],
        "qc_report": _clip_parse_jsonb(row.get("qc_report")),
    }


@router.put("/clip/projects/{project_id}/studio/timeline")
def clip_put_studio_timeline(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    tl = body.get("timeline") if isinstance(body.get("timeline"), dict) else body.get("timeline_json")
    if not isinstance(tl, dict):
        raise HTTPException(status_code=400, detail="timeline 须为对象")
    if not update_clip_timeline_json(project_id=project_id, user_uuid=uid, timeline=tl):
        raise HTTPException(status_code=500, detail="写入时间线失败")
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/studio/snapshots")
def clip_post_studio_snapshot(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    label = str(body.get("label") or "快照").strip()[:200] or "快照"
    snap: dict[str, Any] = {
        "label": label,
        "created_at": body.get("created_at") or datetime.now(timezone.utc).isoformat(),
    }
    if isinstance(body.get("excluded_word_ids"), list):
        snap["excluded_word_ids"] = [str(x).strip() for x in body["excluded_word_ids"] if str(x).strip()][:100000]
    if isinstance(body.get("timeline_json"), dict):
        snap["timeline_json"] = body["timeline_json"]
    if not append_studio_snapshot(project_id=project_id, user_uuid=uid, snapshot=snap):
        raise HTTPException(status_code=500, detail="写入快照失败")
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/studio/notes")
def clip_post_studio_note(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    note: dict[str, Any] = {
        "body": str(body.get("body") or "").strip(),
        "author": str(body.get("author") or "editor").strip()[:80] or "editor",
    }
    if str(body.get("word_id") or "").strip():
        note["word_id"] = str(body.get("word_id")).strip()[:80]
    try:
        if body.get("at_ms") is not None:
            note["at_ms"] = int(body.get("at_ms"))
    except (TypeError, ValueError):
        pass
    if not append_collaboration_note(project_id=project_id, user_uuid=uid, note=note):
        raise HTTPException(status_code=400, detail="备注内容不能为空或写入失败")
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.put("/clip/projects/{project_id}/studio/retakes")
def clip_put_studio_retakes(project_id: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    man = body.get("manifest") if isinstance(body.get("manifest"), list) else body.get("retake_manifest")
    if not isinstance(man, list):
        raise HTTPException(status_code=400, detail="manifest 须为数组")
    clean = [x for x in man if isinstance(x, dict)]
    if not replace_retake_manifest(project_id=project_id, user_uuid=uid, manifest=clean):
        raise HTTPException(status_code=500, detail="写入重录清单失败")
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/studio/retakes/{retake_id}/take")
async def clip_upload_retake_take(project_id: str, retake_id: str, request: Request):
    """上传一条重录 take（原始字节，写入对象存储并挂到 manifest）。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    rid = (retake_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="retake_id 无效")
    body = await request.body()
    if not body or len(body) > _CLIP_STAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="音频过大或为空")
    fn = _clip_filename_from_header(request.headers.get("x-clip-filename"), "retake.mp3")
    fn = _SAFE_NAME.sub("_", fn)[:240] or "retake.mp3"
    mime_raw = (request.headers.get("x-clip-mime") or "application/octet-stream").strip()[:120]
    mime = _effective_audio_media_type(fn, mime_raw)
    owner_seg = uid or "anon"
    sk = f"clip/{owner_seg}/{project_id}/retake_{uuid.uuid4().hex[:14]}_{fn}"
    upload_bytes(sk, body, mime)
    ok = append_retake_take_slot(
        project_id=project_id,
        user_uuid=uid,
        slot_id=rid,
        object_key=sk,
        filename=fn,
        duration_ms=None,
    )
    if not ok:
        delete_object_key(sk)
        raise HTTPException(status_code=400, detail="未找到对应重录槽或写入失败")
    row2 = get_clip_project(project_id=project_id, user_uuid=uid)
    return {"success": True, "object_key": sk, "project": _serialize_clip_row(row2 or {})}


@router.post("/clip/projects/{project_id}/qc/analyze")
def clip_post_qc_analyze(project_id: str, request: Request):
    """听感质检：volumedetect + 已有静音摘要写入 qc_report。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    key = str(row.get("audio_object_key") or "").strip()
    segs_qc = parse_audio_source_segments(row)
    if not key and not segs_qc:
        raise HTTPException(status_code=400, detail="无音频")
    try:
        if key:
            raw = get_object_bytes(key)
            suf = Path(str(row.get("audio_filename") or "clip.bin")).suffix or ".bin"
        else:
            raw = concat_ordered_source_segments_to_bytes(segs_qc)
            suf = ".m4a"
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"读取音频失败: {exc}") from exc
    if not raw or len(raw) < 32:
        raise HTTPException(status_code=400, detail="音频数据无效")
    loud: dict[str, Any] = {}
    try:
        with tempfile.NamedTemporaryFile(prefix="fyv_clip_qc_", suffix=suf, delete=True) as tf:
            tf.write(raw)
            tf.flush()
            loud = dict(analyze_loudness_from_file(Path(tf.name)))
    except Exception as exc:
        logger.warning("clip qc loudness failed project_id=%s err=%s", project_id, exc)
        loud = {"error": str(exc)[:400]}
    sa = _clip_parse_jsonb(row.get("silence_analysis")) or {}
    segs = sa.get("segments") if isinstance(sa.get("segments"), list) else []
    long_silences = 0
    max_gap_ms = 0
    for s in segs[:500]:
        if not isinstance(s, dict):
            continue
        try:
            a = int(s.get("start_ms") or 0)
            b = int(s.get("end_ms") or 0)
        except (TypeError, ValueError):
            continue
        gap = b - a
        max_gap_ms = max(max_gap_ms, gap)
        if gap >= 2500:
            long_silences += 1
    report: dict[str, Any] = {
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "object_key": key,
        "loudness": loud,
        "silence_segments_count": len(segs) if isinstance(segs, list) else 0,
        "silence_long_ge_2p5s": long_silences,
        "silence_max_gap_ms": max_gap_ms,
        "hints": [],
    }
    mv = loud.get("mean_volume_db")
    if isinstance(mv, (int, float)) and mv < -22:
        report["hints"].append("整体电平偏低，导出前可考虑适度提升响度（目标约 -16 LUFS 因节目而异）。")
    if isinstance(mv, (int, float)) and mv > -10:
        report["hints"].append("整体电平偏高，注意失真与平台限幅。")
    if long_silences >= 4:
        report["hints"].append("长静音段较多，可结合精剪时间线或静音建议收紧气口。")
    if not update_qc_report(project_id=project_id, user_uuid=uid, report=report):
        raise HTTPException(status_code=500, detail="写入质检报告失败")
    return {"success": True, "qc_report": report}


@router.post("/clip/projects/{project_id}/audio-events/analyze")
def clip_post_audio_events_analyze(project_id: str, request: Request):
    """触发非语音事件分析（P2）：写入 timeline_json.audio_events。"""
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    if not str(row.get("audio_object_key") or "").strip() and len(parse_audio_source_segments(row)) < 1:
        raise HTTPException(status_code=400, detail="无主素材音频")
    try:
        rq_job = ai_queue.enqueue(run_clip_audio_events_job, project_id, job_timeout="30m")
        rq_id = getattr(rq_job, "id", None)
        logger.info("clip audio_events enqueued project_id=%s rq_job_id=%s", project_id, rq_id)
        return {"success": True, "queued": True, "rq_job_id": rq_id}
    except Exception:
        logger.exception("clip audio_events enqueue failed project_id=%s", project_id)
        raise HTTPException(status_code=503, detail="事件分析任务入队失败，请稍后重试") from None


@router.post("/clip/projects/{project_id}/transcribe")
async def clip_start_transcribe(project_id: str, request: Request):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    t_st = str(row.get("transcription_status") or "").strip()
    if t_st == "running":
        return {"success": True, "queued": False, "message": "转写任务已在进行中"}
    if t_st == "queued":
        return {"success": True, "queued": False, "message": "转写任务已在队列中，请稍候刷新"}
    payload = {}
    try:
        payload = await request.json() or {}
    except Exception:
        payload = {}
    mode = str((payload or {}).get("mode") or "full").strip().lower()
    force_retranscribe = mode == "partial"
    if t_st == "succeeded" and not force_retranscribe:
        raise HTTPException(
            status_code=400,
            detail="已转写成功；如需重新转写请先重新上传音频。",
        )
    if _staging_entries_from_row(row) and not _source_segments_from_row(row):
        raise HTTPException(
            status_code=400,
            detail="仍有多段暂存未合并，请等待自动合并完成或刷新后再转写。",
        )
    segs = _source_segments_from_row(row)
    has_main = bool(str(row.get("audio_object_key") or "").strip())
    if not has_main and len(segs) < 1:
        raise HTTPException(status_code=400, detail="请先上传音频")
    all_seg_k = {str(s.get("key") or "").strip() for s in segs if str(s.get("key") or "").strip()}
    raw_only = payload.get("transcribe_segment_keys")
    only_keys_param: list[str] | None = None
    # 首次 full 须识别全部缺失分段才能 stitch；勾选限制 ASR 范围仅用于 partial（补转/重转勾选段）
    if all_seg_k and force_retranscribe:
        if isinstance(raw_only, list):
            if len(raw_only) == 0:
                raise HTTPException(status_code=400, detail="请勾选至少一段素材进行转写")
            only_keys_param = [str(x).strip() for x in raw_only if str(x).strip()]
            if not only_keys_param:
                raise HTTPException(status_code=400, detail="请勾选至少一段素材进行转写")
            unk = [x for x in only_keys_param if x not in all_seg_k]
            if unk:
                raise HTTPException(status_code=400, detail="transcribe_segment_keys 含无效分段")
    if not volc_seed_auth_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "服务端未配置豆包语音鉴权：请设置 VOLCENGINE_SPEECH_API_KEY（新控制台 API Key），"
                "或同时设置 VOLCENGINE_SPEECH_APP_KEY 与 VOLCENGINE_SPEECH_ACCESS_KEY（旧控制台）"
            ),
        )
    prev_t = t_st if t_st in ("idle", "failed", "succeeded") else "idle"
    if not try_claim_clip_transcription_queued(
        project_id=project_id,
        user_uuid=uid,
        allow_retry_from_succeeded=force_retranscribe,
    ):
        row2 = get_clip_project(project_id=project_id, user_uuid=uid) or {}
        t2 = str(row2.get("transcription_status") or "").strip()
        if t2 in ("running", "queued"):
            return {
                "success": True,
                "queued": False,
                "message": "转写任务已在进行或排队中" if t2 == "running" else "转写任务已在队列中，请稍候刷新",
            }
        raise HTTPException(status_code=409, detail="无法占用转写队列，请刷新后重试")
    try:
        rq_job = ai_queue.enqueue(
            run_clip_transcription_job,
            project_id,
            force_retranscribe=force_retranscribe,
            only_segment_keys=only_keys_param,
            job_timeout="3h",
        )
        rq_id = getattr(rq_job, "id", None)
        logger.info("clip transcribe enqueued project_id=%s rq_job_id=%s", project_id, rq_id)
        return {"success": True, "queued": True, "rq_job_id": rq_id}
    except Exception:
        revert_clip_transcription_after_enqueue_failed(
            project_id=project_id, user_uuid=uid, restore_status=prev_t
        )
        logger.exception("clip transcribe enqueue failed project_id=%s", project_id)
        raise HTTPException(status_code=503, detail="转写任务入队失败，请稍后重试") from None


@router.post("/clip/projects/{project_id}/export")
def clip_start_export(project_id: str, request: Request):
    uid = _owner_uuid(request)
    row = get_clip_project(project_id=project_id, user_uuid=uid)
    if not row:
        raise HTTPException(status_code=404, detail="工程不存在")
    if str(row.get("transcription_status") or "") != "succeeded":
        raise HTTPException(status_code=400, detail="转写未完成，无法导出")
    ex_st = str(row.get("export_status") or "").strip()
    if ex_st == "running":
        return {"success": True, "queued": False, "message": "导出任务已在进行中"}
    if ex_st == "queued":
        return {"success": True, "queued": False, "message": "导出任务已在队列中，请稍候刷新"}
    if ex_st not in ("idle", "failed", "succeeded"):
        raise HTTPException(status_code=400, detail="当前导出状态不可提交")
    prev_ex = ex_st
    if not try_claim_clip_export_queued(project_id=project_id, user_uuid=uid):
        row2 = get_clip_project(project_id=project_id, user_uuid=uid) or {}
        e2 = str(row2.get("export_status") or "").strip()
        if e2 in ("running", "queued"):
            return {
                "success": True,
                "queued": False,
                "message": "导出任务已在进行或排队中" if e2 == "running" else "导出任务已在队列中，请稍候刷新",
            }
        raise HTTPException(status_code=409, detail="无法占用导出队列，请刷新后重试")
    try:
        rq_job = ai_queue.enqueue(run_clip_export_job, project_id, job_timeout="1h")
        rq_id = getattr(rq_job, "id", None)
        logger.info("clip export enqueued project_id=%s rq_job_id=%s", project_id, rq_id)
        return {"success": True, "queued": True, "rq_job_id": rq_id}
    except Exception:
        revert_clip_export_after_enqueue_failed(
            project_id=project_id, user_uuid=uid, restore_status=prev_ex
        )
        logger.exception("clip export enqueue failed project_id=%s", project_id)
        raise HTTPException(status_code=503, detail="导出任务入队失败，请稍后重试") from None


@router.delete("/clip/projects/{project_id}")
def clip_delete_project(project_id: str, request: Request):
    uid = _owner_uuid(request)
    keys = delete_clip_project(project_id=project_id, user_uuid=uid)
    if not keys:
        raise HTTPException(status_code=404, detail="工程不存在")
    for k in (keys.get("audio_object_key"), keys.get("export_object_key")):
        if k:
            delete_object_key(str(k))
    for sk in keys.get("staging_object_keys") or []:
        if sk:
            delete_object_key(str(sk))
    for rk in keys.get("retake_object_keys") or []:
        if rk:
            delete_object_key(str(rk))
    return {"success": True}
