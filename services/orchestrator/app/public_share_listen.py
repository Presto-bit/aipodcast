"""匿名打开「发给朋友」页所需的成片试听元数据（不含 payload / 全文稿）。"""

from __future__ import annotations

import json
import logging
from typing import Any
from .models import get_job
from .object_store import (
    is_likely_internal_object_store_http_url,
    list_mp3_object_keys_under_prefix,
    object_key_exists,
    presigned_get_url,
    resolve_job_audio_object_key_from_result,
)
from .storage_paths import job_artifact_base

logger = logging.getLogger(__name__)

_PUBLIC_JOB_TYPES = frozenset({"podcast", "podcast_generate"})
_PODCASTISH_STORAGE_PROBE = frozenset({"podcast", "podcast_generate", "podcast_short_video"})

# 「我的作品」试听：排除明显无成片音频的内部任务；其余只要 result 里可签发/可回退直链即允许（避免新 job_type 漏进白名单导致 404）
_OWNER_WORK_LISTEN_DENY_TYPES = frozenset(
    {
        "note_rag_index",
        "auth_register",
        "auth_login",
    }
)


def _coerce_result(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            o = json.loads(raw)
            return o if isinstance(o, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def probe_episode_audio_object_key(row: dict[str, Any]) -> str | None:
    """
    result 未写入 audio_object_key / audio_url 时，按成片上传约定探测对象是否存在。
    兼容：DB 未登记、仅历史内网 URL 被 API 剥离、或写入 result 失败但对象已在桶内。
    """
    jid = str(row.get("id") or "").strip()
    if not jid:
        return None
    cb = row.get("created_by")
    oid = str(cb).strip() if cb is not None and str(cb).strip() else ""
    oid = oid or None
    candidates: list[str] = []
    if oid:
        candidates.append(f"{job_artifact_base(jid, oid)}/episode_audio.mp3")
    candidates.append(f"{job_artifact_base(jid, None)}/episode_audio.mp3")
    seen: set[str] = set()
    for cand in candidates:
        if cand in seen:
            continue
        seen.add(cand)
        if object_key_exists(cand):
            return cand
    # 约定文件名不存在时：枚举该 job 存储前缀下的 MP3（兼容历史/异常命名）
    prefixes: list[str] = []
    if oid:
        prefixes.append(f"jobs/u/{oid}/{jid}/")
    prefixes.append(f"jobs/{jid}/")
    best: tuple[int, str] | None = None
    for pref in prefixes:
        for k in list_mp3_object_keys_under_prefix(pref, max_keys=100):
            if k in seen:
                continue
            seen.add(k)
            leaf = k.rsplit("/", 1)[-1].lower()
            score = 100 if "episode" in leaf else 70
            if best is None or score > best[0] or (score == best[0] and len(k) < len(best[1])):
                best = (score, k)
    return best[1] if best else None


def _resolve_audio_object_key(result: dict[str, Any], row: dict[str, Any], *, allow_storage_probe: bool) -> str:
    k = resolve_job_audio_object_key_from_result(result)
    if k:
        return k
    if not allow_storage_probe:
        return ""
    return (probe_episode_audio_object_key(row) or "").strip()


def build_public_share_listen_bundle(job_id: str) -> dict[str, Any] | None:
    """
    仅成功、未删除、播客成片；返回可直链播放的音频 URL。
    有 audio_object_key 时优先新鲜预签名；失败或为空时回退 result.audio_url。
    """
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, None)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt not in _PUBLIC_JOB_TYPES:
        return None

    result = _coerce_result(row.get("result"))
    key = _resolve_audio_object_key(result, row, allow_storage_probe=True)
    legacy_url = str(result.get("audio_url") or "").strip()
    audio_url = legacy_url
    if key:
        try:
            fresh = presigned_get_url(key, expires_in=86400 * 7)
            if fresh:
                audio_url = str(fresh).strip()
        except Exception:
            logger.warning("public_share_listen presign failed job_id=%s", jid, exc_info=True)
    if not audio_url:
        return None
    if is_likely_internal_object_store_http_url(audio_url):
        return None

    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"

    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None

    preview = str(result.get("preview") or result.get("script_preview") or "").strip()
    if len(preview) > 500:
        preview = preview[:499] + "…"

    chapters = result.get("audio_chapters")
    safe_chapters: list[dict[str, Any]] = []
    if isinstance(chapters, list):
        for o in chapters[:32]:
            if not isinstance(o, dict):
                continue
            safe_chapters.append(
                {
                    "title": str(o.get("title") or "章节")[:200],
                    "start_ms": int(o.get("start_ms") or 0),
                }
            )

    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
        "preview": preview,
        "audio_chapters": safe_chapters,
    }


def build_podcast_template_listen_bundle(job_id: str) -> dict[str, Any] | None:
    """
    已标记为全站创作模板的播客成片：登录用户可试听，不含 payload / 全文稿。
    """
    from .models import ensure_jobs_trash_schema

    ensure_jobs_trash_schema()
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, None)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if not bool(row.get("is_podcast_template")):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt not in _PUBLIC_JOB_TYPES:
        return None
    result = _coerce_result(row.get("result"))
    key = _resolve_audio_object_key(result, row, allow_storage_probe=True)
    legacy_url = str(result.get("audio_url") or "").strip()
    audio_url = legacy_url
    if key:
        try:
            fresh = presigned_get_url(key, expires_in=86400 * 7)
            if fresh:
                audio_url = str(fresh).strip()
        except Exception:
            logger.warning("podcast_template_listen presign failed job_id=%s", jid, exc_info=True)
    if not audio_url:
        return None
    if is_likely_internal_object_store_http_url(audio_url):
        return None
    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"
    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None
    preview = str(result.get("preview") or result.get("script_preview") or "").strip()
    if len(preview) > 500:
        preview = preview[:499] + "…"
    chapters = result.get("audio_chapters")
    safe_chapters: list[dict[str, Any]] = []
    if isinstance(chapters, list):
        for o in chapters[:32]:
            if not isinstance(o, dict):
                continue
            safe_chapters.append(
                {
                    "title": str(o.get("title") or "章节")[:200],
                    "start_ms": int(o.get("start_ms") or 0),
                }
            )
    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
        "preview": preview,
        "audio_chapters": safe_chapters,
    }


def explain_owner_work_listen_miss(job_id: str, user_ref: str | None) -> dict[str, Any]:
    """
    work-listen 无法返回 bundle 时的结构化说明（写入 404 JSON，不含密钥与完整 URL）。
    用于区分：任务不可见、未成功、result 无引用、仅内网链、预签名失败、桶前缀下无 MP3。
    """
    jid = (job_id or "").strip()
    out: dict[str, Any] = {"job_id": jid or None, "stage": "unknown"}
    if not jid:
        out["stage"] = "invalid_job_id"
        return out
    row = get_job(jid, user_ref)
    if not row:
        out["stage"] = "job_not_found_or_forbidden"
        return out
    if row.get("deleted_at"):
        out["stage"] = "job_deleted"
        return out
    st = str(row.get("status") or "").strip().lower()
    if st != "succeeded":
        out["stage"] = "job_not_succeeded"
        out["job_status"] = st
        return out
    jt = str(row.get("job_type") or "").strip().lower()
    out["job_type"] = jt
    if jt in _OWNER_WORK_LISTEN_DENY_TYPES:
        out["stage"] = "job_type_not_listenable"
        return out
    result = _coerce_result(row.get("result"))
    legacy = str(result.get("audio_url") or "").strip()
    has_hex = bool(str(result.get("audio_hex") or "").strip())
    has_obj_key = bool(str(result.get("audio_object_key") or "").strip())
    probe_ok = jt in _PODCASTISH_STORAGE_PROBE
    key = _resolve_audio_object_key(result, row, allow_storage_probe=probe_ok)
    out["result_has_audio_hex"] = has_hex
    out["result_has_audio_object_key"] = has_obj_key
    out["result_has_audio_url"] = bool(legacy)
    out["podcast_storage_probe_eligible"] = probe_ok
    out["resolved_object_key"] = bool(key)
    mp3_sample = 0
    if probe_ok:
        cb = row.get("created_by")
        oid = str(cb).strip() if cb is not None and str(cb).strip() else ""
        oid = oid or None
        if oid:
            mp3_sample += len(list_mp3_object_keys_under_prefix(f"jobs/u/{oid}/{jid}/", max_keys=40))
        mp3_sample += len(list_mp3_object_keys_under_prefix(f"jobs/{jid}/", max_keys=40))
        out["mp3_count_under_standard_job_prefixes"] = mp3_sample
    if not key and not legacy:
        out["stage"] = "no_object_key_and_no_audio_url"
        out["hint_zh"] = (
            "数据库 result 中无 audio_object_key / audio_url；按约定前缀在桶内也未发现 MP3 样本。"
            "若确认成片应存在：检查编排器镜像是否已更新、MinIO 桶与 OBJECT_ENDPOINT 是否一致，或重跑任务。"
        )
        return out
    if legacy and is_likely_internal_object_store_http_url(legacy) and not key:
        out["stage"] = "only_internal_storage_audio_url"
        out["hint_zh"] = (
            "result.audio_url 为内网对象存储地址且无法解析出 object key；请确保桶内成片可被探测并写入 audio_object_key，"
            "或升级编排器使「我的作品」试听走同源 /api/jobs/:id/work-audio 流式代理。"
        )
        return out
    if key:
        if not object_key_exists(key):
            out["stage"] = "object_missing_in_bucket"
            out["hint_zh"] = "result 或桶探测得到 object key，但桶内 head 不存在；可能 key 错误、对象已删或连错桶。"
            return out
        out["stage"] = "unexpected_bundle_miss_key_present"
        out["hint_zh"] = (
            "桶内对象存在但 work-listen 未返回 bundle；请确认编排器已部署「同源 work-audio 流式代理」版本并查看日志。"
        )
        return out
    out["stage"] = "bundle_rejected_other"
    out["hint_zh"] = "未生成试听 bundle；请携带 request_id 查编排器日志。"
    return out


def resolve_owner_work_listen_storage_key(job_id: str, user_ref: str | None) -> str | None:
    """
    与 work-listen 归属/状态一致；返回桶内 object key，供 GET …/work-audio 同源流式代理（不经公网预签名）。
    """
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, user_ref)
    if not row or row.get("deleted_at"):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt in _OWNER_WORK_LISTEN_DENY_TYPES:
        return None
    result = _coerce_result(row.get("result"))
    probe_ok = jt in _PODCASTISH_STORAGE_PROBE
    key = (_resolve_audio_object_key(result, row, allow_storage_probe=probe_ok) or "").strip()
    return key or None


def build_owner_work_listen_bundle(job_id: str, user_ref: str | None) -> dict[str, Any] | None:
    """
    已登录用户播放「我的作品」：校验任务归属后返回可播放 URL。
    有 object key 时返回同源路径 `/api/jobs/{id}/work-audio`（Web 流式反代编排器读桶，无需公网 OBJECT_PRESIGN_ENDPOINT）；
    否则回退 result.audio_url（须为浏览器可达的外链，非内网 MinIO）。
    """
    jid = (job_id or "").strip()
    if not jid:
        return None
    row = get_job(jid, user_ref)
    if not row:
        return None
    if row.get("deleted_at"):
        return None
    if str(row.get("status") or "").strip().lower() != "succeeded":
        return None
    jt = str(row.get("job_type") or "").strip().lower()
    if jt in _OWNER_WORK_LISTEN_DENY_TYPES:
        return None

    result = _coerce_result(row.get("result"))
    legacy_url = str(result.get("audio_url") or "").strip()
    probe_ok = jt in _PODCASTISH_STORAGE_PROBE
    key = (_resolve_audio_object_key(result, row, allow_storage_probe=probe_ok) or "").strip()
    if not key and not legacy_url:
        return None
    if key:
        audio_url = f"/api/jobs/{jid}/work-audio"
    elif legacy_url and not is_likely_internal_object_store_http_url(legacy_url):
        audio_url = legacy_url
    else:
        return None
    if is_likely_internal_object_store_http_url(audio_url):
        return None

    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "未命名节目"

    dur_raw = result.get("audio_duration_sec")
    dur: float | None = None
    if isinstance(dur_raw, (int, float)) and float(dur_raw) > 0:
        dur = float(dur_raw)
    elif isinstance(dur_raw, str) and dur_raw.strip():
        try:
            d = float(dur_raw)
            if d > 0:
                dur = d
        except ValueError:
            dur = None

    return {
        "job_id": jid,
        "job_type": jt,
        "title": title[:300],
        "audio_url": audio_url,
        "audio_duration_sec": dur,
    }
