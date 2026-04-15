import base64
import binascii
import json
import logging
import os
import time
import uuid
from typing import Any

import psycopg2
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response, StreamingResponse
from rq.job import Job

from .. import auth_bridge
from ..config import settings

_jobs_startup_logger = logging.getLogger(__name__)

# 无新 job_events 时每轮 sleep 3s；过小会在长脚本/长合成期间误断 SSE，表现为「进度卡住」。
SSE_EVENT_IDLE_TICKS_MAX = 2400  # 约 2 小时
from ..job_serialization import serialize_job
from ..entitlement_matrix import voice_clone_monthly_included, voice_clone_payg_cents
from ..media_wallet import (
    estimate_spoken_minutes_podcast_enqueue,
    estimate_spoken_minutes_tts,
    media_wallet_billing_enabled,
    preview_wallet_cents_for_media_job,
)
from ..models import (
    append_job_event,
    cancel_job_if_runnable,
    count_succeeded_voice_clone_jobs_for_user_uuid,
    create_job,
    delete_job_and_storage,
    ensure_default_project,
    ensure_jobs_trash_schema,
    get_job,
    get_job_artifact,
    get_project_name,
    list_job_artifacts,
    list_job_events,
    list_jobs,
    list_recent_works,
    list_trashed_works,
    merge_job_result,
    purge_expired_trashed_works,
    restore_deleted_job,
    resolved_user_uuid_string,
    soft_delete_job,
    wallet_balance_cents_for_phone,
)
from ..mp3_export import build_export_mp3
from ..object_store import get_object_bytes, presigned_get_url, upload_bytes
from ..rss_publish_store import user_download_allowed_for_succeeded_works, work_download_allowed
from ..queue import ai_queue, media_queue, redis_conn
from ..schemas import (
    JobAudioExportRequest,
    JobCoverDataRequest,
    JobCreateRequest,
    SocialViralCopyRequest,
)
from ..social_viral_copy import generate_viral_social_copy
from ..security import verify_internal_signature
from ..subscription_limits import max_note_refs_for_plan
from ..storage_paths import job_cover_object_key
from ..note_work_meta import (
    NOTES_SOURCE_TITLES_CAP,
    human_note_source_label,
    snapshot_notes_source_titles,
)
from ..worker_tasks import run_ai_job, run_media_job

router = APIRouter(prefix="/api/v1", tags=["jobs"], dependencies=[Depends(verify_internal_signature)])
WORK_TRASH_RETENTION_DAYS = settings.trash_retention_days


def _list_jobs_db_unreachable(exc: BaseException) -> bool:
    try:
        from psycopg2 import pool as pg_pool_mod
    except ImportError:
        pg_pool_mod = None  # type: ignore[assignment]
    if isinstance(exc, (psycopg2.OperationalError, psycopg2.InterfaceError)):
        return True
    return pg_pool_mod is not None and isinstance(exc, pg_pool_mod.PoolError)


def _list_jobs_schema_error(exc: BaseException) -> bool:
    return isinstance(exc, psycopg2.ProgrammingError)
_JOB_COVER_MAX_BYTES = 8 * 1024 * 1024


def _media_queue_timeout_for_payload(job_type: str, payload: Any) -> str:
    _ = job_type, payload
    return "20m"


def _distribution_pack_markdown(result: dict[str, Any]) -> str:
    title = str(result.get("title") or "").strip()
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:80] + ("…" if len(prev) > 80 else "")) if prev else "本期节目"
    script = str(result.get("script_text") or result.get("preview") or "").strip()
    hook = (script[:500] + ("…" if len(script) > 500 else "")) if script else "（暂无全文，可在作品页打开文稿后复制）"
    lines = [
        f"## {title}",
        "",
        "### 动态文案（可直接粘贴后微调）",
        hook,
        "",
        "### 话题标签（示例）",
        "#播客 #知识分享 #口播",
        "",
        "### 分发清单",
        "- 音频：使用下方 signed URL 或站内导出 MP3",
        "- 封面：用于专辑头图",
    ]
    return "\n".join(lines)


def _cover_ext_type_from_upload(content_type: str | None) -> tuple[str, str]:
    ct = str(content_type or "").strip().lower()
    if "png" in ct:
        return "png", "image/png"
    if "webp" in ct:
        return "webp", "image/webp"
    if "gif" in ct:
        return "gif", "image/gif"
    if "bmp" in ct:
        return "bmp", "image/bmp"
    if "jpeg" in ct or "jpg" in ct:
        return "jpg", "image/jpeg"
    return "jpg", "image/jpeg"


def _job_storage_owner_uuid(created_by: Any) -> str | None:
    if created_by is None:
        return None
    s = str(created_by).strip()
    return s or None


def _parse_job_result_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            j = json.loads(raw)
            return j if isinstance(j, dict) else {}
        except Exception:
            return {}
    return {}


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


def _job_row_scope_ref(request: Request) -> str | None:
    """
    与 list_jobs_api 一致的任务行级隔离参数：
    普通用户为手机号；管理员为 None（可访问任意任务行，否则删除/详情会对他人任务误判为不存在）。
    """
    user_ref = _current_user_ref_or_401(request)
    if user_ref and auth_bridge.is_admin_phone(user_ref):
        return None
    return user_ref


def _coerce_row_payload(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            o = json.loads(raw)
            return o if isinstance(o, dict) else {}
        except Exception:
            return {}
    return {}


def _work_has_audio_hex(result: dict[str, Any]) -> bool:
    """作品列表用：slim result 含 has_audio_hex；旧数据仍读 audio_hex / audio_object_key。"""
    if "has_audio_hex" in result:
        return bool(result.get("has_audio_hex"))
    return bool(result.get("audio_hex")) or bool(str(result.get("audio_object_key") or "").strip())


def _work_cover_display_url(result: dict[str, Any], job_id: str) -> str:
    """列表用封面 URL：优先 result 内外链；仅持久化了 cover_object_key 时回落到网关路径。"""
    cov = str(result.get("cover_image") or result.get("coverImage") or "").strip()
    if cov:
        return cov
    if str(result.get("cover_object_key") or "").strip():
        jid = str(job_id or "").strip()
        if jid:
            return f"/api/jobs/{jid}/cover"
    return ""


def _works_script_notes_extras(result: dict[str, Any], payload: dict[str, Any], job_type: str) -> dict[str, Any]:
    """作品列表：文章字数与笔记本来源（script_draft / 播客成片）。"""
    out: dict[str, Any] = {}
    sc = result.get("script_char_count")
    if sc is not None:
        try:
            v = int(sc)
            if v > 0:
                out["scriptCharCount"] = v
        except (TypeError, ValueError):
            pass
    if "scriptCharCount" not in out:
        st = result.get("script_text")
        if isinstance(st, str) and st.strip():
            out["scriptCharCount"] = len(st.strip())
    if "scriptCharCount" not in out and job_type in ("text_to_speech", "tts"):
        tx = str(payload.get("text") or "").strip()
        if tx:
            out["scriptCharCount"] = len(tx)
    nb = str(result.get("notes_source_notebook") or payload.get("notes_notebook") or "").strip()
    nc_raw = result.get("notes_source_note_count")
    if nc_raw is None:
        sn = payload.get("selected_note_ids")
        if isinstance(sn, list):
            nc_raw = sum(1 for x in sn if isinstance(x, str) and str(x).strip())
        else:
            nc_raw = 0
    try:
        nci = int(nc_raw) if nc_raw is not None else 0
    except (TypeError, ValueError):
        nci = 0
    if nb:
        out["notesSourceNotebook"] = nb
    if nci > 0:
        out["notesSourceNoteCount"] = nci
    titles_raw = result.get("notes_source_titles")
    titles: list[str] = []
    if isinstance(titles_raw, list) and titles_raw:
        for x in titles_raw:
            titles.append(human_note_source_label(x))
    else:
        titles = snapshot_notes_source_titles(payload)
    if titles:
        out["notesSourceTitles"] = titles[:NOTES_SOURCE_TITLES_CAP]
    if bool(payload.get("notes_notebook_studio_detach")):
        out["notesNotebookStudioDetached"] = True
    return out


def _trim_note_refs_payload(payload: dict[str, Any], phone: str) -> None:
    """与创建任务一致：按套餐裁剪 selected_note_ids / titles。"""
    if not (phone or "").strip():
        return
    try:
        tier = str(auth_bridge.user_info_for_phone(phone).get("plan") or "free")
        cap = max_note_refs_for_plan(tier)
        sn = payload.get("selected_note_ids")
        if isinstance(sn, list) and len(sn) > cap:
            trimmed_ids = [str(x).strip() for x in sn if isinstance(x, str) and str(x).strip()][:cap]
            payload["selected_note_ids"] = trimmed_ids
            st = payload.get("selected_note_titles")
            if isinstance(st, list):
                payload["selected_note_titles"] = [str(x).strip() for x in st][:cap]
    except Exception:
        pass


def _media_job_wallet_preview_dict(phone: str | None, job_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """创建 / 预检共用：媒体钱包是否足够覆盖预估超量分钟。"""
    jt = str(job_type or "").strip().lower()
    out: dict[str, Any] = {"media_wallet_billing_enabled": bool(media_wallet_billing_enabled()), "job_type": jt}
    if not media_wallet_billing_enabled():
        out["allowed"] = True
        return out
    p = (phone or "").strip()
    if not p:
        out["allowed"] = True
        return out
    if jt not in ("text_to_speech", "tts", "podcast_generate", "podcast"):
        out["allowed"] = True
        return out
    tier = str(auth_bridge.user_info_for_phone(p).get("plan") or "free")
    if jt in ("podcast_generate", "podcast"):
        est_m = float(estimate_spoken_minutes_podcast_enqueue(payload))
    else:
        body_m = str(payload.get("text") or "").strip() or "你好，欢迎使用 AI Native Studio。"
        est_m = float(estimate_spoken_minutes_tts(payload, body_m))
    need_cents = int(preview_wallet_cents_for_media_job(p, tier, est_m))
    bal_m = int(wallet_balance_cents_for_phone(p))
    out["estimated_spoken_minutes"] = round(est_m, 2)
    out["wallet_charge_cents"] = need_cents
    out["wallet_balance_cents"] = bal_m
    out["tier"] = tier
    if need_cents > 0 and bal_m < need_cents:
        out["allowed"] = False
        out["detail"] = (
            f"预估成片约 {est_m:.1f} 分钟，超出当前套餐与分钟包后约需 ¥{need_cents / 100:.2f}，"
            f"钱包余额 ¥{bal_m / 100:.2f} 不足，请先充值。"
        )
    else:
        out["allowed"] = True
        if need_cents > 0:
            out["summary"] = (
                f"预估口播约 {est_m:.1f} 分钟；超出套餐/分钟包后约需从钱包扣 ¥{need_cents / 100:.2f}（当前余额 ¥{bal_m / 100:.2f}）。"
            )
        else:
            out["summary"] = f"预估口播约 {est_m:.1f} 分钟；预计在套餐与分钟包额度内，无需额外扣钱包。"
    return out


def _enforce_media_wallet_for_enqueue(phone: str | None, job_type: str, payload: dict[str, Any]) -> None:
    prev = _media_job_wallet_preview_dict(phone, job_type, payload)
    if not prev.get("allowed", True):
        raise HTTPException(status_code=400, detail=str(prev.get("detail") or "钱包余额不足"))


@router.post("/jobs/preview-media")
def preview_media_job_api(req: JobCreateRequest, request: Request):
    """创建前用量与钱包预估（与 POST /jobs 媒体计费逻辑一致，不落库）。未开媒体钱包或未识别用户时直接 allowed。"""
    if str(req.job_type or "").strip().lower() == "podcast_short_video":
        raise HTTPException(status_code=400, detail="短视频合成功能已移除。")
    user_ref = _current_user_ref_or_401(request)
    payload = dict(req.payload or {})
    if "api_key" in payload:
        payload.pop("api_key", None)
    phone = (user_ref or req.created_by or "").strip()
    _trim_note_refs_payload(payload, phone)
    body = _media_job_wallet_preview_dict(phone, str(req.job_type), payload)
    body["success"] = True
    return JSONResponse(jsonable_encoder(body))


@router.post("/jobs")
def create_job_api(req: JobCreateRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    if str(req.job_type or "").strip().lower() == "podcast_short_video":
        raise HTTPException(status_code=400, detail="短视频合成功能已移除。")
    payload = dict(req.payload or {})
    if "api_key" in payload:
        payload.pop("api_key", None)

    phone = (user_ref or req.created_by or "").strip()
    _trim_note_refs_payload(payload, phone)

    if str(req.job_type or "").strip().lower() in ("voice_clone", "clone_voice") and phone:
        uid = resolved_user_uuid_string(phone)
        if uid:
            tier = str(auth_bridge.user_info_for_phone(phone).get("plan") or "free")
            used = count_succeeded_voice_clone_jobs_for_user_uuid(uid)
            inc = voice_clone_monthly_included(tier)
            if used >= inc:
                pay = voice_clone_payg_cents()
                bal = wallet_balance_cents_for_phone(phone)
                if bal < pay:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"套餐内克隆次数已用完，单次克隆需 ¥{pay / 100:.2f}，"
                            f"钱包余额不足（当前 ¥{bal / 100:.2f}）。请先充值后再试。"
                        ),
                    )

    jt_media = str(req.job_type or "").strip().lower()
    if (
        jt_media in ("text_to_speech", "tts", "podcast_generate", "podcast")
        and phone
        and media_wallet_billing_enabled()
    ):
        try:
            _enforce_media_wallet_for_enqueue(phone, jt_media, payload)
        except HTTPException:
            raise
        except Exception as exc:
            _jobs_startup_logger.warning("media wallet preview skipped: %s", exc)

    project_id = ensure_default_project(req.project_name, created_by=user_ref or req.created_by)
    job_id = create_job(
        project_id=project_id,
        job_type=req.job_type,
        queue_name=req.queue_name,
        payload=payload,
        created_by=user_ref or req.created_by,
    )

    if "api_key" in (req.payload or {}):
        append_job_event(job_id, "log", "已忽略 payload.api_key，改用服务端密钥注入", {"source": "server_env"})

    if req.queue_name == "media":
        media_timeout = _media_queue_timeout_for_payload(req.job_type, payload)
        rq_job = media_queue.enqueue(run_media_job, job_id, job_timeout=media_timeout)
    else:
        rq_job = ai_queue.enqueue(run_ai_job, job_id, job_timeout="20m")

    append_job_event(job_id, "log", "队列任务已创建", {"rq_job_id": rq_job.id})
    rid = getattr(request.state, "request_id", None)
    if rid:
        append_job_event(job_id, "log", "HTTP 请求关联", {"request_id": rid})
    row = get_job(job_id)
    return JSONResponse(jsonable_encoder(serialize_job(row)))


@router.get("/works")
def list_works_api(
    request: Request,
    limit: int = Query(default=80, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10_000),
):
    user_ref = _current_user_ref_or_401(request)
    rows = list_recent_works(limit=limit, offset=offset, user_ref=user_ref)
    buckets: dict[str, list[dict[str, Any]]] = {"notes": [], "ai": [], "tts": []}
    _proj_name_cache: dict[str, str] = {}
    download_allowed_bulk = user_download_allowed_for_succeeded_works(user_ref or "")

    def project_name_for(pid_raw: str) -> str:
        pid = (pid_raw or "").strip()
        if not pid:
            return ""
        if pid in _proj_name_cache:
            return _proj_name_cache[pid]
        n = get_project_name(pid) or ""
        _proj_name_cache[pid] = n
        return n

    for row in rows:
        raw_result = row.get("result")
        if isinstance(raw_result, dict):
            result = raw_result
        elif isinstance(raw_result, str) and raw_result.strip():
            try:
                result = json.loads(raw_result)
            except Exception:
                result = {}
        else:
            result = {}
        job_type = str(row.get("job_type") or "")
        preview_src = result.get("preview") or result.get("script_preview") or ""
        ps = str(preview_src or "").strip()
        preview_list = ps[:400] + ("…" if len(ps) > 400 else "")
        title_raw = str(result.get("title") or "").strip()
        if title_raw:
            title = title_raw[:200]
        elif ps:
            title = (ps[:80] + "…") if len(ps) > 80 else ps
        else:
            title = job_type or "未命名作品"
        _dur = result.get("audio_duration_sec")
        _dur_out: float | None
        if _dur is not None and str(_dur).strip() != "":
            try:
                _dur_out = float(_dur)
                if not (_dur_out >= 0 and _dur_out < 86400):
                    _dur_out = None
            except (TypeError, ValueError):
                _dur_out = None
        else:
            _dur_out = None
        _pid = str(row.get("project_id") or "").strip()
        _jid = str(row.get("id"))
        _payload_dict = _coerce_row_payload(row.get("payload"))
        _program_name = str(
            _payload_dict.get("program_name") or result.get("program_name") or ""
        ).strip()
        _proj_name_row = str(row.get("project_name") or "").strip()
        work = {
            "id": _jid,
            "title": title,
            "createdAt": str(row.get("completed_at") or row.get("created_at") or ""),
            "audioUrl": str(result.get("audio_url") or ""),
            "scriptUrl": str(result.get("script_url") or ""),
            "scriptText": preview_list,
            "hasAudioHex": _work_has_audio_hex(result),
            "audioDurationSec": _dur_out,
            "coverImage": _work_cover_display_url(result, _jid),
            "status": str(row.get("status") or ""),
            "type": job_type,
            "projectName": _proj_name_row or project_name_for(_pid),
            "downloadAllowed": download_allowed_bulk,
        }
        if _program_name:
            work["workProgramName"] = _program_name[:200]
        work.update(_works_script_notes_extras(result, _payload_dict, job_type))
        if job_type in ("text_to_speech", "tts"):
            buckets["tts"].append(work)
        elif job_type in ("script_draft", "podcast_generate", "podcast", "podcast_short_video"):
            buckets["ai"].append(work)
        else:
            buckets["notes"].append(work)
    has_more = len(rows) >= limit
    return {
        "success": True,
        **buckets,
        "total": len(rows),
        "has_more": has_more,
        "limit": limit,
        "offset": offset,
    }


@router.get("/jobs")
def list_jobs_api(
    request: Request,
    limit: int = Query(default=40, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=50_000),
    status: str | None = Query(default=None),
    slim: int = Query(default=1, ge=0, le=1),
):
    try:
        scope_ref = _job_row_scope_ref(request)
        rows = list_jobs(limit=limit, offset=offset, status=status, slim=bool(slim), user_ref=scope_ref)
        has_more = len(rows) >= limit
        return JSONResponse(
            jsonable_encoder(
                {
                    "success": True,
                    "jobs": [serialize_job(r) for r in rows],
                    "has_more": has_more,
                    "offset": offset,
                    "limit": limit,
                }
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        _jobs_startup_logger.exception("list_jobs_api failed")
        if _list_jobs_db_unreachable(exc):
            raise HTTPException(status_code=503, detail="database_unavailable") from exc
        if _list_jobs_schema_error(exc):
            raise HTTPException(status_code=500, detail="jobs_schema_outdated") from exc
        raise HTTPException(status_code=500, detail="list_jobs_failed") from exc


@router.get("/jobs/{job_id}")
def get_job_api(job_id: str, request: Request):
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    out = serialize_job(row)
    arts = list_job_artifacts(job_id)
    for a in arts:
        if a.get("created_at") is not None:
            a["created_at"] = str(a["created_at"])
        if a.get("id") is not None:
            a["id"] = str(a["id"])
    out["artifacts"] = arts
    return JSONResponse(jsonable_encoder(out))


def _delete_job_json(job_id: str, row_scope_ref: str | None) -> JSONResponse:
    row = get_job(job_id, user_ref=row_scope_ref)
    if not row:
        return JSONResponse(jsonable_encoder({"success": True, "already_gone": True}))
    if row.get("deleted_at"):
        return JSONResponse(jsonable_encoder({"success": True, "already_gone": True}))
    ok = soft_delete_job(job_id, user_ref=row_scope_ref)
    if ok:
        return JSONResponse(jsonable_encoder({"success": True, "moved_to_trash": True}))
    row2 = get_job(job_id, user_ref=row_scope_ref)
    if row2 and row2.get("deleted_at"):
        return JSONResponse(jsonable_encoder({"success": True, "moved_to_trash": True}))
    raise HTTPException(status_code=409, detail="delete_failed")


@router.delete("/jobs/{job_id}")
def delete_job_api(job_id: str, request: Request):
    return _delete_job_json(job_id, row_scope_ref=_job_row_scope_ref(request))


@router.post("/jobs/{job_id}/delete")
def delete_job_post_alias_api(job_id: str, request: Request):
    return _delete_job_json(job_id, row_scope_ref=_job_row_scope_ref(request))


@router.get("/works/trash")
def list_works_trash_api(
    request: Request,
    limit: int = Query(default=80, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10_000),
):
    # 按默认策略：回收站作品保留 7 天，访问列表时顺带清理过期数据。
    purge_expired_trashed_works(retention_days=WORK_TRASH_RETENTION_DAYS, max_rows=settings.trash_purge_max_rows)
    user_ref = _current_user_ref_or_401(request)
    rows = list_trashed_works(limit=limit, offset=offset, user_ref=user_ref)
    buckets: dict[str, list[dict[str, Any]]] = {"notes": [], "ai": [], "tts": []}
    _proj_name_cache: dict[str, str] = {}
    download_allowed_bulk = user_download_allowed_for_succeeded_works(user_ref or "")

    def project_name_for(pid_raw: str) -> str:
        pid = (pid_raw or "").strip()
        if not pid:
            return ""
        if pid in _proj_name_cache:
            return _proj_name_cache[pid]
        n = get_project_name(pid) or ""
        _proj_name_cache[pid] = n
        return n

    for row in rows:
        raw_result = row.get("result")
        if isinstance(raw_result, dict):
            result = raw_result
        elif isinstance(raw_result, str) and raw_result.strip():
            try:
                result = json.loads(raw_result)
            except Exception:
                result = {}
        else:
            result = {}
        job_type = str(row.get("job_type") or "")
        preview_src = result.get("preview") or result.get("script_preview") or ""
        ps = str(preview_src or "").strip()
        preview_list = ps[:400] + ("…" if len(ps) > 400 else "")
        title_raw = str(result.get("title") or "").strip()
        if title_raw:
            title = title_raw[:200]
        elif ps:
            title = (ps[:80] + "…") if len(ps) > 80 else ps
        else:
            title = job_type or "未命名作品"
        _dur = result.get("audio_duration_sec")
        _dur_out: float | None
        if _dur is not None and str(_dur).strip() != "":
            try:
                _dur_out = float(_dur)
                if not (_dur_out >= 0 and _dur_out < 86400):
                    _dur_out = None
            except (TypeError, ValueError):
                _dur_out = None
        else:
            _dur_out = None
        _pid = str(row.get("project_id") or "").strip()
        _jid = str(row.get("id"))
        _proj_name_row = str(row.get("project_name") or "").strip()
        work = {
            "id": _jid,
            "title": title,
            "createdAt": str(row.get("completed_at") or row.get("created_at") or ""),
            "deletedAt": str(row.get("deleted_at") or ""),
            "audioUrl": str(result.get("audio_url") or ""),
            "scriptUrl": str(result.get("script_url") or ""),
            "scriptText": preview_list,
            "hasAudioHex": _work_has_audio_hex(result),
            "audioDurationSec": _dur_out,
            "coverImage": _work_cover_display_url(result, _jid),
            "status": str(row.get("status") or ""),
            "type": job_type,
            "projectName": _proj_name_row or project_name_for(_pid),
            "downloadAllowed": download_allowed_bulk,
        }
        if job_type in ("text_to_speech", "tts"):
            buckets["tts"].append(work)
        elif job_type in ("script_draft", "podcast_generate", "podcast", "podcast_short_video"):
            buckets["ai"].append(work)
        else:
            buckets["notes"].append(work)
    has_more = len(rows) >= limit
    return {
        "success": True,
        **buckets,
        "total": len(rows),
        "has_more": has_more,
        "limit": limit,
        "offset": offset,
    }


@router.post("/jobs/{job_id}/restore")
def restore_job_api(job_id: str, request: Request):
    ok = restore_deleted_job(job_id, user_ref=_job_row_scope_ref(request))
    if not ok:
        raise HTTPException(status_code=404, detail="job_not_found")
    return {"success": True, "job_id": job_id}


def _cancel_rq_job_enqueued_for_db_job_id(job_id: str) -> None:
    """在 ai/media 队列中查找 RQ Job（首参为 job_id）并 cancel。队列基础设施异常会向外抛出，供 cancel API 记录。"""
    target = str(job_id).strip()
    if not target:
        return
    max_scan = 8000
    scanned = 0
    for q_name in ("ai", "media"):
        from rq import Queue

        queue = Queue(name=q_name, connection=redis_conn)
        for rq_jid in queue.job_ids:
            scanned += 1
            if scanned > max_scan:
                return
            try:
                j = Job.fetch(rq_jid, connection=redis_conn)
            except Exception:
                continue
            if j and j.args and str(j.args[0]) == target:
                j.cancel()
                return


def _purge_job_impl(job_id: str, request: Request) -> dict[str, Any]:
    """硬删任务行与存储。
    - 已在回收站（deleted_at）：硬删。
    - 未进回收站：允许排队/执行中、已结束终态（含失败/取消）或 succeeded（成品），便于「进行中」任务先取消再删或直接从列表移除。
    """
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    if row.get("deleted_at") is None:
        st = str(row.get("status") or "")
        if st not in ("queued", "running", "succeeded", "failed", "cancelled"):
            raise HTTPException(status_code=400, detail="job_not_in_trash")
    # 硬删前在服务端统一取消并摘队列，避免浏览器端 cancel 失败或竞态导致删库后 Worker 仍把任务写回 queued/running
    if str(row.get("status") or "") in ("queued", "running"):
        cancel_job_if_runnable(job_id)
        try:
            _cancel_rq_job_enqueued_for_db_job_id(job_id)
        except Exception:
            pass
    ok, err = delete_job_and_storage(job_id)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "purge_failed")
    try:
        purge_expired_trashed_works(retention_days=WORK_TRASH_RETENTION_DAYS, max_rows=settings.trash_purge_max_rows)
    except Exception:
        pass
    return {"success": True, "job_id": job_id}


@router.delete("/jobs/{job_id}/purge")
def purge_job_api_delete(job_id: str, request: Request):
    return _purge_job_impl(job_id, request)


@router.post("/jobs/{job_id}/purge")
def purge_job_api_post(job_id: str, request: Request):
    """与 DELETE 等价，便于 BFF/代理环境避免对 DELETE 的异常处理。"""
    return _purge_job_impl(job_id, request)


def ensure_jobs_trash_schema_startup(*, strict: bool = False) -> None:
    try:
        ensure_jobs_trash_schema()
        purge_expired_trashed_works(retention_days=WORK_TRASH_RETENTION_DAYS, max_rows=settings.trash_purge_max_rows)
    except Exception:
        _jobs_startup_logger.exception("jobs trash schema startup failed")
        if strict:
            raise


@router.get("/jobs/{job_id}/artifacts/{artifact_id}/download")
def download_job_artifact_api(job_id: str, artifact_id: str, request: Request):
    scope = _job_row_scope_ref(request)
    if not get_job(job_id, user_ref=scope):
        raise HTTPException(status_code=404, detail="job_not_found")
    if not work_download_allowed(job_id, scope or ""):
        raise HTTPException(status_code=403, detail="下载需订阅")
    art = get_job_artifact(job_id, artifact_id)
    if not art:
        raise HTTPException(status_code=404, detail="artifact_not_found")
    key = str(art.get("object_key") or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="artifact_no_key")
    try:
        data = get_object_bytes(key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"object_fetch_failed:{exc}") from exc
    mime = str(art.get("mime_type") or "application/octet-stream").strip() or "application/octet-stream"
    safe_name = key.rsplit("/", 1)[-1] or "download"
    if not safe_name.endswith((".txt", ".md", ".json")) and mime.startswith("text/"):
        safe_name = f"{safe_name}.txt"
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.get("/jobs/{job_id}/cover")
def download_job_cover_api(
    job_id: str,
    request: Request,
    signed: int = Query(default=0, ge=0, le=1),
    expires_in: int = Query(default=3600, ge=60, le=86400 * 7),
):
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    raw_result = row.get("result")
    if isinstance(raw_result, dict):
        result = raw_result
    elif isinstance(raw_result, str) and raw_result.strip():
        try:
            result = json.loads(raw_result)
        except Exception:
            result = {}
    else:
        result = {}
    key = str(result.get("cover_object_key") or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="cover_not_found")
    mime = str(result.get("cover_content_type") or "").strip() or "image/jpeg"
    if signed:
        try:
            url = presigned_get_url(key, expires_in=expires_in)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"cover_signed_url_failed:{exc}") from exc
        return JSONResponse({"url": url, "expires_in": expires_in, "content_type": mime})
    try:
        data = get_object_bytes(key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"cover_fetch_failed:{exc}") from exc
    return Response(content=data, media_type=mime)


@router.post("/jobs/{job_id}/cover")
def upload_job_cover_api(job_id: str, request: Request, body: JobCoverDataRequest = Body(...)):
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    if str(row.get("status") or "") != "succeeded":
        raise HTTPException(status_code=400, detail="job_not_succeeded")
    try:
        raw = base64.b64decode(str(body.image_base64 or "").strip(), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="cover_base64_invalid") from exc
    if not raw:
        raise HTTPException(status_code=400, detail="cover_empty")
    if len(raw) > _JOB_COVER_MAX_BYTES:
        raise HTTPException(status_code=400, detail="cover_too_large")
    ext, safe_ct = _cover_ext_type_from_upload(body.content_type)
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        ext, safe_ct = "png", "image/png"
    elif raw[:2] == b"\xff\xd8":
        ext, safe_ct = "jpg", "image/jpeg"
    elif raw[:6] in (b"GIF87a", b"GIF89a"):
        ext, safe_ct = "gif", "image/gif"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        ext, safe_ct = "webp", "image/webp"
    oid = _job_storage_owner_uuid(row.get("created_by"))
    object_key = job_cover_object_key(job_id, oid, ext=ext)
    try:
        upload_bytes(object_key, raw, content_type=safe_ct)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"cover_upload_failed:{exc}") from exc
    public_path = f"/api/jobs/{job_id}/cover"
    err = merge_job_result(
        job_id,
        _job_row_scope_ref(request),
        {
            "cover_object_key": object_key,
            "cover_content_type": safe_ct,
            "cover_image": public_path,
        },
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"success": True, "cover_image": public_path}


@router.post("/jobs/{job_id}/audio-export")
def export_job_audio_mp3_api(
    job_id: str,
    request: Request,
    body: JobAudioExportRequest | None = Body(default=None),
):
    opts = body or JobAudioExportRequest()
    scope = _job_row_scope_ref(request)
    row = get_job(job_id, user_ref=scope)
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    if not work_download_allowed(job_id, scope or ""):
        raise HTTPException(status_code=403, detail="下载需订阅")
    result = _parse_job_result_dict(row.get("result"))
    hx = str(result.get("audio_hex") or "").strip()
    raw_mp3: bytes
    if hx and len(hx) % 2 == 0:
        try:
            raw_mp3 = bytes.fromhex(hx)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="audio_hex_invalid") from exc
    else:
        akey = str(result.get("audio_object_key") or "").strip()
        if not akey:
            raise HTTPException(status_code=400, detail="work_audio_missing")
        try:
            raw_mp3 = get_object_bytes(akey)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"object_fetch_failed:{exc}") from exc
        if not raw_mp3:
            raise HTTPException(status_code=400, detail="work_audio_missing")
    chapters_raw = result.get("audio_chapters")
    chapters = chapters_raw if opts.embed_chapters and isinstance(chapters_raw, list) else None
    title = (opts.title or "").strip() or str(result.get("title") or "")[:300]
    if not title:
        prev = str(result.get("preview") or result.get("script_preview") or "").strip()
        title = (prev[:120] + ("…" if len(prev) > 120 else "")) if prev else "episode"
    out_bytes = build_export_mp3(
        raw_mp3,
        title=title,
        artist=(opts.artist or "").strip(),
        album=(opts.album or "").strip(),
        chapters=chapters,
    )
    safe_stub = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in title)[:48] or "episode"
    filename = f"{safe_stub}.mp3"
    return Response(
        content=out_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/jobs/{job_id}/distribution-pack")
def distribution_pack_api(
    job_id: str,
    request: Request,
    expires_in: int = Query(default=3600, ge=60, le=86400 * 7),
):
    """
    短期「全平台分发」辅助：返回 MP3/封面/各画幅短视频的预签名直链 + 一段可复制 Markdown 文案骨架。
    需任务已成功且相应产物已写入对象存储（音频优先 audio_object_key，否则仅提供站内 audio-export 路径说明）。
    """
    scope = _job_row_scope_ref(request)
    row = get_job(job_id, user_ref=scope)
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    if str(row.get("status") or "") != "succeeded":
        raise HTTPException(status_code=400, detail="job_not_succeeded")
    if not work_download_allowed(job_id, scope or ""):
        raise HTTPException(status_code=403, detail="下载需订阅")
    result = _parse_job_result_dict(row.get("result"))
    pack: dict[str, Any] = {
        "job_id": job_id,
        "expires_in": expires_in,
        "urls": {},
        "relative": {
            "audio_export_post": f"/api/jobs/{job_id}/audio-export",
            "cover_get": f"/api/jobs/{job_id}/cover",
        },
        "copy_markdown": _distribution_pack_markdown(result),
    }
    akey = str(result.get("audio_object_key") or "").strip()
    if akey:
        try:
            pack["urls"]["audio_mp3"] = {
                "url": presigned_get_url(akey, expires_in=expires_in),
                "expires_in": expires_in,
            }
        except Exception as exc:
            pack["urls"]["audio_mp3"] = {"error": str(exc)[:200]}
    ckey = str(result.get("cover_object_key") or "").strip()
    if ckey:
        try:
            pack["urls"]["cover_image"] = {
                "url": presigned_get_url(ckey, expires_in=expires_in),
                "expires_in": expires_in,
            }
        except Exception as exc:
            pack["urls"]["cover_image"] = {"error": str(exc)[:200]}
    return pack


@router.post("/jobs/{job_id}/retry")
def retry_job_api(job_id: str, request: Request):
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    if str(row.get("job_type") or "").strip().lower() == "podcast_short_video":
        raise HTTPException(status_code=400, detail="短视频合成功能已移除，无法重试该任务。")
    st = str(row.get("status") or "")
    if st == "running":
        raise HTTPException(status_code=400, detail="job_running")
    if st == "queued":
        raise HTTPException(status_code=400, detail="job_queued")
    payload = row.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    payload = dict(payload)
    payload.pop("api_key", None)
    project_id = str(row.get("project_id") or "").strip()
    if not project_id:
        project_id = ensure_default_project("ai-native-core-platform", created_by=row.get("created_by"))
    job_type = str(row.get("job_type") or "script_draft").strip() or "script_draft"
    queue_name = str(row.get("queue_name") or "ai").strip().lower()
    if queue_name not in ("ai", "media"):
        queue_name = "ai"
    created_by = row.get("created_by")
    if created_by is not None:
        created_by = str(created_by)

    new_id = create_job(
        project_id=project_id,
        job_type=job_type,
        queue_name=queue_name,
        payload=payload,
        created_by=created_by,
    )
    append_job_event(
        new_id,
        "log",
        "由任务重试创建",
        {"source_job_id": str(job_id), "prior_status": st},
    )
    if queue_name == "media":
        media_timeout = _media_queue_timeout_for_payload(job_type, payload)
        rq_job = media_queue.enqueue(run_media_job, new_id, job_timeout=media_timeout)
    else:
        rq_job = ai_queue.enqueue(run_ai_job, new_id, job_timeout="20m")
    append_job_event(new_id, "log", "队列任务已创建", {"rq_job_id": rq_job.id})
    new_row = get_job(new_id)
    return JSONResponse(jsonable_encoder(serialize_job(new_row)))


@router.post("/jobs/{job_id}/cancel")
def cancel_job_api(job_id: str, request: Request):
    scope = _job_row_scope_ref(request)
    row = get_job(job_id, user_ref=scope)
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    outcome = cancel_job_if_runnable(job_id)
    if outcome == "not_found":
        raise HTTPException(status_code=404, detail="job_not_found")
    if outcome == "noop":
        row = get_job(job_id, user_ref=scope)
        st = str(row.get("status") or "") if row else ""
        return {"ok": True, "job_id": job_id, "status": st, "already_terminal": True}

    append_job_event(job_id, "error", "任务已取消", {"status": "cancelled"})

    try:
        _cancel_rq_job_enqueued_for_db_job_id(job_id)
    except Exception as exc:
        append_job_event(
            job_id,
            "log",
            "队列取消未完全成功（可忽略，若任务已出队）",
            {"detail": str(exc)[:300]},
        )

    return {"ok": True, "job_id": job_id, "status": "cancelled"}


@router.get("/jobs/{job_id}/events")
def stream_job_events(job_id: str, request: Request, after_id: int = 0):
    scope = _job_row_scope_ref(request)
    if not get_job(job_id, user_ref=scope):
        raise HTTPException(status_code=404, detail="job_not_found")

    def _event_gen():
        pointer = after_id
        idle_ticks = 0
        while True:
            events = list_job_events(job_id, after_id=pointer)
            if events:
                idle_ticks = 0
                for ev in events:
                    pointer = int(ev["id"])
                    payload = {
                        "id": ev["id"],
                        "type": ev["event_type"],
                        "message": ev["message"],
                        "payload": ev["event_payload"],
                        "created_at": str(ev["created_at"]),
                    }
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            else:
                idle_ticks += 1
                yield "event: ping\ndata: {}\n\n"

            row = get_job(job_id, user_ref=scope)
            if row and row.get("status") in ("succeeded", "failed", "cancelled"):
                done_payload = {"type": "terminal", "status": row.get("status"), "job_id": job_id}
                yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"
                break
            if idle_ticks > SSE_EVENT_IDLE_TICKS_MAX:
                break
            time.sleep(3)

    return StreamingResponse(_event_gen(), media_type="text/event-stream")


@router.post("/social/viral-copy")
def social_viral_copy_api(req: SocialViralCopyRequest, request: Request):
    phone = _current_user_ref_or_401(request)
    scope = _job_row_scope_ref(request)
    row = get_job(req.source_job_id.strip(), user_ref=scope)
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    raw_result = row.get("result")
    if isinstance(raw_result, dict):
        result = raw_result
    elif isinstance(raw_result, str) and raw_result.strip():
        try:
            result = json.loads(raw_result)
        except Exception:
            result = {}
    else:
        result = {}
    script = str(result.get("script_text") or result.get("preview") or result.get("script_preview") or "").strip()
    if not script:
        raise HTTPException(status_code=400, detail="source_has_no_script")
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None
    if not api_key:
        raise HTTPException(status_code=503, detail="服务端未配置 MINIMAX_API_KEY")
    tier = None
    if phone:
        try:
            tier = str(auth_bridge.user_info_for_phone(phone).get("plan") or "free")
        except Exception:
            tier = "free"
    try:
        pack = generate_viral_social_copy(
            script,
            platform=req.platform,
            api_key=api_key,
            subscription_tier=tier,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:500]) from exc
    return JSONResponse(jsonable_encoder({"success": True, **pack}))
