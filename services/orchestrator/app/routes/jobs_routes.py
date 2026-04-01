import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response, StreamingResponse
from rq.job import Job

from .. import auth_bridge

_jobs_startup_logger = logging.getLogger(__name__)
from ..job_serialization import serialize_job
from ..models import (
    append_job_event,
    cancel_job_if_runnable,
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
    purge_expired_trashed_works,
    restore_deleted_job,
    soft_delete_job,
)
from ..object_store import get_object_bytes
from ..queue import ai_queue, media_queue, redis_conn
from ..schemas import JobCreateRequest
from ..security import verify_internal_signature
from ..subscription_limits import max_note_refs_for_plan
from ..worker_tasks import run_ai_job, run_media_job

router = APIRouter(prefix="/api/v1", tags=["jobs"], dependencies=[Depends(verify_internal_signature)])
WORK_TRASH_RETENTION_DAYS = 7


def _current_user_ref_or_401(request: Request) -> str | None:
    if not auth_bridge.is_auth_enabled():
        return None
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = str(sess.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    return phone


def _job_row_scope_ref(request: Request) -> str | None:
    """
    与 list_jobs_api 一致的任务行级隔离参数：
    普通用户为手机号；管理员为 None（可访问任意任务行，否则删除/详情会对他人任务误判为不存在）。
    """
    user_ref = _current_user_ref_or_401(request)
    if user_ref and auth_bridge.is_admin_phone(user_ref):
        return None
    return user_ref


@router.post("/jobs")
def create_job_api(req: JobCreateRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    payload = dict(req.payload or {})
    if "api_key" in payload:
        payload.pop("api_key", None)

    phone = (user_ref or req.created_by or "").strip()
    if phone:
        try:
            tier = str(auth_bridge.user_info_for_phone(phone).get("plan") or "free")
            cap = max_note_refs_for_plan(tier)
            sn = payload.get("selected_note_ids")
            if isinstance(sn, list) and len(sn) > cap:
                payload["selected_note_ids"] = [str(x).strip() for x in sn if isinstance(x, str) and str(x).strip()][:cap]
        except Exception:
            pass

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
        rq_job = media_queue.enqueue(run_media_job, job_id, job_timeout="20m")
    else:
        rq_job = ai_queue.enqueue(run_ai_job, job_id, job_timeout="20m")

    append_job_event(job_id, "log", "队列任务已创建", {"rq_job_id": rq_job.id})
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
        work = {
            "id": str(row.get("id")),
            "title": title,
            "createdAt": str(row.get("completed_at") or row.get("created_at") or ""),
            "audioUrl": str(result.get("audio_url") or ""),
            "scriptUrl": str(result.get("script_url") or ""),
            "scriptText": preview_list,
            "hasAudioHex": bool(result.get("audio_hex")),
            "audioDurationSec": _dur_out,
            "coverImage": str(result.get("cover_image") or result.get("coverImage") or ""),
            "status": str(row.get("status") or ""),
            "type": job_type,
            "projectName": project_name_for(_pid),
        }
        if job_type in ("text_to_speech", "tts"):
            buckets["tts"].append(work)
        elif job_type in ("script_draft", "podcast_generate", "podcast"):
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
    purge_expired_trashed_works(retention_days=WORK_TRASH_RETENTION_DAYS, max_rows=500)
    user_ref = _current_user_ref_or_401(request)
    rows = list_trashed_works(limit=limit, offset=offset, user_ref=user_ref)
    buckets: dict[str, list[dict[str, Any]]] = {"notes": [], "ai": [], "tts": []}
    _proj_name_cache: dict[str, str] = {}

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
        work = {
            "id": str(row.get("id")),
            "title": title,
            "createdAt": str(row.get("completed_at") or row.get("created_at") or ""),
            "deletedAt": str(row.get("deleted_at") or ""),
            "audioUrl": str(result.get("audio_url") or ""),
            "scriptUrl": str(result.get("script_url") or ""),
            "scriptText": preview_list,
            "hasAudioHex": bool(result.get("audio_hex")),
            "audioDurationSec": _dur_out,
            "coverImage": str(result.get("cover_image") or result.get("coverImage") or ""),
            "status": str(row.get("status") or ""),
            "type": job_type,
            "projectName": project_name_for(_pid),
        }
        if job_type in ("text_to_speech", "tts"):
            buckets["tts"].append(work)
        elif job_type in ("script_draft", "podcast_generate", "podcast"):
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


@router.delete("/jobs/{job_id}/purge")
def purge_job_api(job_id: str, request: Request):
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    if row.get("deleted_at") is None:
        raise HTTPException(status_code=400, detail="job_not_in_trash")
    ok, err = delete_job_and_storage(job_id)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "purge_failed")
    return {"success": True, "job_id": job_id}


def ensure_jobs_trash_schema_startup(*, strict: bool = False) -> None:
    try:
        ensure_jobs_trash_schema()
        purge_expired_trashed_works(retention_days=WORK_TRASH_RETENTION_DAYS, max_rows=500)
    except Exception:
        _jobs_startup_logger.exception("jobs trash schema startup failed")
        if strict:
            raise


@router.get("/jobs/{job_id}/artifacts/{artifact_id}/download")
def download_job_artifact_api(job_id: str, artifact_id: str, request: Request):
    if not get_job(job_id, user_ref=_job_row_scope_ref(request)):
        raise HTTPException(status_code=404, detail="job_not_found")
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
def download_job_cover_api(job_id: str, request: Request):
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
    try:
        data = get_object_bytes(key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"cover_fetch_failed:{exc}") from exc
    mime = str(result.get("cover_content_type") or "").strip() or "image/jpeg"
    return Response(content=data, media_type=mime)


@router.post("/jobs/{job_id}/retry")
def retry_job_api(job_id: str, request: Request):
    row = get_job(job_id, user_ref=_job_row_scope_ref(request))
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
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
        rq_job = media_queue.enqueue(run_media_job, new_id, job_timeout="20m")
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
        target = str(job_id).strip()
        max_scan = 8000
        scanned = 0
        cancelled_rq = False
        for q_name in ("ai", "media"):
            from rq import Queue

            queue = Queue(name=q_name, connection=redis_conn)
            for rq_jid in queue.job_ids:
                scanned += 1
                if scanned > max_scan:
                    break
                try:
                    j = Job.fetch(rq_jid, connection=redis_conn)
                except Exception:
                    continue
                if j and j.args and str(j.args[0]) == target:
                    j.cancel()
                    cancelled_rq = True
                    break
            if cancelled_rq:
                break
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
            if idle_ticks > 120:
                break
            time.sleep(3)

    return StreamingResponse(_event_gen(), media_type="text/event-stream")
