import base64
import hashlib
import json
import logging
import os
import time
import uuid
from urllib.parse import urlparse

import psycopg2
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..config import settings
from ..fyv_shared.content_parser import content_parser
from ..url_fetch_hints import actionable_hint_for_failed_url
from ..note_constants import (
    ALLOWED_NOTE_EXT,
    VIDEO_NOTE_EXT,
    MAX_NOTE_UPLOAD_BYTES,
    MAX_URL_IMPORT_CHARS,
    NOTE_PREVIEW_TEXT_MAX,
)
from ..models import (
    NOTES_PODCAST_STUDIO_PROJECT,
    create_file_note,
    create_job,
    create_notebook_only,
    create_text_note,
    delete_note,
    delete_notebook_db,
    ensure_default_project,
    ensure_notebooks_schema,
    find_duplicate_file_note_id,
    get_note_by_id,
    get_notebook_sharing_row,
    get_shared_notebook_public_access,
    increment_public_notebook_view,
    list_notebook_names,
    list_notes,
    list_notebook_covers_meta,
    list_popular_public_notebooks,
    list_trashed_notes,
    list_user_notebook_sharing_meta,
    ensure_default_library_notebook,
    migrate_legacy_default_notebook_for_user,
    purge_expired_trashed_notes,
    purge_note_hard,
    patch_notebook_cover_db,
    read_notebook_cover_bytes_owner,
    read_notebook_cover_bytes_public,
    rename_notebook_db,
    resolved_user_uuid_string,
    upload_notebook_cover_db,
    restore_note,
    set_notebook_sharing,
    update_note_title,
)
from ..queue import ai_queue
from ..worker_tasks import run_ai_job
from ..storage_paths import note_upload_object_key
from ..note_document_extract import NoteParseResult, extract_text_from_bytes
from ..object_store import delete_object_key, get_object_bytes, upload_bytes
from ..notes_ask import (
    _prepare_notes_ask_messages,
    answer_notes_question,
    generate_notes_ask_hints,
    iter_notes_answer_events,
)
from ..note_rag_service import count_rag_chunks_for_notes, ensure_note_rag_schema
from ..schemas import (
    NoteCreateRequest,
    NoteImportUrlRequest,
    NotePatchRequest,
    NoteUploadJsonRequest,
    NotebookCreateRequest,
    NotebookPatchRequest,
    NotebookSharingPatchRequest,
    NotebookViewIncrementRequest,
    NotesAskHintsRequest,
    NotesAskRequest,
)

_notes_startup_logger = logging.getLogger(__name__)
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1", tags=["notes"], dependencies=[Depends(verify_internal_signature)])
NOTE_TRASH_RETENTION_DAYS = settings.trash_retention_days


def _metadata_notebook_from_row(row: dict) -> str:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    if not isinstance(md, dict):
        return ""
    return str(md.get("notebook") or "").strip()


def _shared_list_owner_uuid_or_none(
    request: Request,
    *,
    notebook: str | None,
    shared_from_owner_user_id: str | None,
) -> str | None:
    del request
    sid = (shared_from_owner_user_id or "").strip() or None
    if not sid:
        return None
    nb = (notebook or "").strip() or None
    if not nb:
        raise HTTPException(status_code=400, detail="notebook_required_for_shared_view")
    if not get_shared_notebook_public_access(sid, nb):
        raise HTTPException(status_code=404, detail="notebook_not_shared")
    return sid


def _try_enqueue_note_rag_index(note_id: str, user_ref: str | None) -> None:
    """异步：切块嵌入 + 摘要，供勾选范围内向量检索。"""
    try:
        pid = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
        jid = create_job(pid, "note_rag_index", "ai", {"note_id": note_id}, user_ref)
        ai_queue.enqueue(run_ai_job, jid, job_timeout="15m")
    except Exception as exc:
        _notes_startup_logger.warning("note_rag_index enqueue failed note_id=%s: %s", note_id, exc)


def _current_user_ref_or_401(request: Request) -> str | None:
    from .. import auth_bridge

    if not auth_bridge.is_auth_enabled():
        return None
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        raise HTTPException(status_code=401, detail="未登录")
    phone = auth_bridge.session_principal(sess)
    if not phone:
        raise HTTPException(status_code=401, detail="未登录")
    return phone


def _optional_user_ref(request: Request) -> str | None:
    """有会话则返回 principal；无会话返回 None（用于公开分享只读浏览）。"""
    from .. import auth_bridge

    if not auth_bridge.is_auth_enabled():
        return None
    sess = auth_bridge.get_session_by_bearer(request.headers.get("authorization", ""))
    if not sess:
        return None
    return auth_bridge.session_principal(sess) or None


def _mime_for_note_ext(ext: str) -> str:
    e = (ext or "").lower()
    return {
        "pdf": "application/pdf",
        "epub": "application/epub+zip",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
        "markdown": "text/markdown; charset=utf-8",
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "xhtml": "application/xhtml+xml; charset=utf-8",
    }.get(e, "application/octet-stream")


def _persist_note_upload(
    user_ref: str | None,
    data: bytes,
    raw_name: str,
    title_in: str,
    notebook: str,
    project_name: str,
) -> dict:
    """写入对象存储、解析正文、落库；供 upload_json 与 upload_raw 共用。"""
    try:
        ensure_notebooks_schema()
    except Exception as exc:
        _notes_startup_logger.exception("notes upload: ensure_notebooks_schema failed")
        raise HTTPException(status_code=503, detail="笔记存储未就绪，请稍后重试。") from exc
    raw_name = (raw_name or "").strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="无效文件名")
    if "." not in raw_name:
        raw_name = f"{raw_name}.txt"
    ext = raw_name.rsplit(".", 1)[1].lower()
    if ext in VIDEO_NOTE_EXT:
        raise HTTPException(
            status_code=400,
            detail="视频类文件暂不支持识别正文，请改用网页链接、HTML 导出或文稿类文件",
        )
    if ext not in ALLOWED_NOTE_EXT:
        raise HTTPException(status_code=400, detail="笔记格式不支持")
    if len(data) > MAX_NOTE_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="文件过大")
    original_title = raw_name.rsplit(".", 1)[0].strip() if "." in raw_name else raw_name
    title = (title_in or "").strip() or original_title or raw_name
    notebook = (notebook or "").strip()
    if not notebook:
        raise HTTPException(status_code=400, detail="notebook_required")
    content_sha256 = hashlib.sha256(data).hexdigest()
    project_id = ensure_default_project(project_name, created_by=user_ref)
    dup_id = find_duplicate_file_note_id(
        project_id,
        notebook,
        content_sha256=content_sha256,
        original_filename=raw_name,
        size=len(data),
    )
    if dup_id:
        row = get_note_by_id(dup_id, user_ref=user_ref)
        if row:
            md_raw = row.get("metadata") or {}
            if isinstance(md_raw, str):
                try:
                    md = json.loads(md_raw) if md_raw.strip() else {}
                except Exception:
                    md = {}
            else:
                md = md_raw if isinstance(md_raw, dict) else {}
            p_st = str(md.get("parseStatus") or "").strip()
            p_eng = str(md.get("parseEngine") or "").strip()
            p_de = str(md.get("parseDetail") or "").strip()[:500]
            p_enc = str(md.get("parseEncoding") or "").strip()[:120]
            tit = str(md.get("title") or title).strip() or title
            ext_out = str(md.get("ext") or ext).lower() or ext
            ct = str(row.get("content_text") or "").strip()
            parse_empty = bool(len(data) > 0 and not ct)
            out_dup: dict = {
                "success": True,
                "deduped": True,
                "note": {
                    "noteId": dup_id,
                    "title": tit,
                    "notebook": notebook,
                    "ext": ext_out,
                    "relativePath": f"/api/notes/{dup_id}/file",
                    "createdAt": str(row.get("created_at") or ""),
                },
                "parse": {
                    "status": p_st or "ok",
                    "engine": p_eng,
                    "detail": p_de,
                    "encoding": p_enc,
                },
            }
            if parse_empty:
                out_dup["parseEmpty"] = True
            return out_dup
    note_id = f"note_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    owner_uuid = resolved_user_uuid_string(user_ref)
    object_key = note_upload_object_key(note_id, ext, owner_uuid)
    try:
        upload_bytes(object_key, data, content_type=_mime_for_note_ext(ext))
    except Exception as exc:
        _notes_startup_logger.exception("notes upload: object store upload failed")
        raise HTTPException(
            status_code=503,
            detail="文件暂无法上传到存储，请确认对象存储可用后重试。",
        ) from exc
    try:
        parse_result = extract_text_from_bytes(data, ext)
    except Exception as exc:
        _notes_startup_logger.exception("notes upload: extract_text_from_bytes failed")
        parse_result = NoteParseResult(
            text="",
            status="error",
            engine="exception",
            detail=str(exc)[:400],
        )
    parsed = (parse_result.text or "").strip()
    extra_meta: dict[str, object] = {
        "parseStatus": parse_result.status,
        "parseEngine": parse_result.engine,
    }
    if parse_result.detail:
        extra_meta["parseDetail"] = str(parse_result.detail)[:500]
    if parse_result.encoding:
        extra_meta["parseEncoding"] = str(parse_result.encoding)[:120]
    extra_meta["contentSha256"] = content_sha256
    try:
        row_id = create_file_note(
            project_id=project_id,
            title=title,
            notebook=notebook,
            content_text=parsed,
            file_object_key=object_key,
            ext=ext,
            original_filename=raw_name,
            size=len(data),
            source_url=None,
            user_ref=user_ref,
            extra_metadata=extra_meta,
        )
    except ValueError as e:
        delete_object_key(object_key)
        if str(e) == "notebook_required":
            raise HTTPException(status_code=400, detail="notebook_required") from e
        raise
    except Exception as exc:
        delete_object_key(object_key)
        _notes_startup_logger.exception("notes upload: create_file_note failed")
        if isinstance(exc, psycopg2.ProgrammingError):
            raise HTTPException(
                status_code=503,
                detail="数据库结构与当前版本不一致（常见于未执行迁移）。请联系运维更新数据库后重试。",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail="笔记保存失败，请稍后重试或联系管理员。",
        ) from exc
    _try_enqueue_note_rag_index(row_id, user_ref)
    parse_empty = bool(len(data) > 0 and not (parsed or "").strip())
    out: dict = {
        "success": True,
        "note": {
            "noteId": row_id,
            "title": title,
            "notebook": notebook,
            "ext": ext,
            "relativePath": f"/api/notes/{row_id}/file",
            "createdAt": "",
        },
        "parse": {
            "status": parse_result.status,
            "engine": parse_result.engine,
            "detail": (parse_result.detail or "")[:500],
            "encoding": (parse_result.encoding or "")[:120],
        },
    }
    if parse_empty:
        out["parseEmpty"] = True
    return out


@router.get("/notes")
def list_notes_api(
    request: Request,
    notebook: str | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=50_000),
    shared_from_owner_user_id: str | None = Query(default=None, alias="sharedFromOwnerUserId"),
):
    nb = (notebook or "").strip() or None
    sid = (shared_from_owner_user_id or "").strip() or None
    if sid and not nb:
        raise HTTPException(status_code=400, detail="notebook_required_for_shared_view")
    if sid and nb:
        owner_uuid = _shared_list_owner_uuid_or_none(
            request, notebook=nb, shared_from_owner_user_id=shared_from_owner_user_id
        )
        user_ref = _optional_user_ref(request)
    else:
        user_ref = _current_user_ref_or_401(request)
        owner_uuid = None
    rows = list_notes(
        notebook=nb,
        limit=limit,
        offset=offset,
        user_ref=user_ref,
        project_owner_user_uuid=owner_uuid,
    )
    notes: list[dict[str, object]] = []
    for r in rows:
        md = r.get("metadata") or {}
        if isinstance(md, str):
            try:
                md = json.loads(md)
            except Exception:
                md = {}
        it = str(r.get("input_type") or "")
        ext = str(md.get("ext") or ("txt" if it == "note_text" else "")).lower()
        note_uuid = str(r.get("id"))
        file_key = r.get("file_object_key")
        ct = str(r.get("content_text") or "").strip()
        if it == "note_text":
            source_ready = len(ct) > 0
            source_hint = "文本笔记，可作资料摘录" if source_ready else "正文为空"
        else:
            source_ready = len(ct) >= 20
            source_hint = "正文已抽取，可作资料" if source_ready else "正文过短或未抽取，建议预览或重新上传"
        rag_err = r.get("note_rag_index_error")
        rag_chunks = int(r.get("rag_chunk_count") or 0)
        p_st = str(md.get("parseStatus") or "").strip()
        p_de = str(md.get("parseDetail") or "").strip()
        if p_st:
            parse_ok = p_st == "ok"
        else:
            parse_ok = (it == "note_text") or (it == "note_file" and source_ready)
        notes.append(
            {
                "noteId": note_uuid,
                "title": str(md.get("title") or "未命名笔记"),
                "notebook": str(md.get("notebook") or ""),
                "ext": ext or "txt",
                "relativePath": f"/api/notes/{note_uuid}/file" if file_key else "",
                "createdAt": str(r.get("created_at") or ""),
                "sourceUrl": str(r.get("source_url") or md.get("sourceUrl") or ""),
                "inputType": it,
                "sourceReady": source_ready,
                "sourceHint": source_hint,
                "ragChunkCount": rag_chunks,
                "ragIndexError": (str(rag_err).strip() if rag_err else ""),
                "ragIndexedAt": str(r.get("note_rag_index_at") or ""),
                "parseStatus": p_st,
                "parseEngine": str(md.get("parseEngine") or "").strip(),
                "parseDetail": p_de,
                "parseEncoding": str(md.get("parseEncoding") or "").strip(),
                "parseOk": parse_ok,
            }
        )
    has_more = len(rows) >= limit
    shared_mode = (
        get_shared_notebook_public_access(owner_uuid, nb) if owner_uuid and nb else None
    )
    return {
        "success": True,
        "notes": notes,
        "has_more": has_more,
        "sharedAccess": shared_mode,
        "sharedFromOwnerUserId": owner_uuid,
    }


@router.get("/notes/trash")
def list_trash_notes_api(
    request: Request,
    limit: int = Query(default=40, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=50_000),
):
    # 默认保留 7 天，查询回收站时顺带清理过期项。
    purge_expired_trashed_notes(retention_days=NOTE_TRASH_RETENTION_DAYS, max_rows=settings.trash_purge_max_rows)
    user_ref = _current_user_ref_or_401(request)
    rows = list_trashed_notes(limit=limit, offset=offset, user_ref=user_ref)
    notes: list[dict[str, object]] = []
    for r in rows:
        md = r.get("metadata") or {}
        if isinstance(md, str):
            try:
                md = json.loads(md)
            except Exception:
                md = {}
        it = str(r.get("input_type") or "")
        ext = str(md.get("ext") or ("txt" if it == "note_text" else "")).lower()
        note_uuid = str(r.get("id"))
        file_key = r.get("file_object_key")
        ct = str(r.get("content_text") or "").strip()
        if it == "note_text":
            source_ready = len(ct) > 0
            source_hint = "文本笔记，可作资料摘录" if source_ready else "正文为空"
        else:
            source_ready = len(ct) >= 20
            source_hint = "正文已抽取，可作资料" if source_ready else "正文过短或未抽取，建议预览或重新上传"
        notes.append(
            {
                "noteId": note_uuid,
                "title": str(md.get("title") or "未命名笔记"),
                "notebook": str(md.get("notebook") or ""),
                "ext": ext or "txt",
                "relativePath": f"/api/notes/{note_uuid}/file" if file_key else "",
                "createdAt": str(r.get("created_at") or ""),
                "deletedAt": str(r.get("deleted_at") or ""),
                "sourceUrl": str(r.get("source_url") or md.get("sourceUrl") or ""),
                "inputType": it,
                "sourceReady": source_ready,
                "sourceHint": source_hint,
            }
        )
    has_more = len(rows) >= limit
    return {"success": True, "notes": notes, "has_more": has_more}


@router.post("/notes")
def create_note_api(req: NoteCreateRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    nb = req.notebook.strip()
    if not nb:
        raise HTTPException(status_code=400, detail="notebook_required")
    project_id = ensure_default_project(req.project_name, created_by=user_ref)
    try:
        note_id = create_text_note(
            project_id=project_id,
            title=req.title.strip() or "未命名笔记",
            notebook=nb,
            content=req.content,
            source_url=(req.source_url or "").strip() or None,
            user_ref=user_ref,
        )
    except ValueError as e:
        if str(e) == "notebook_required":
            raise HTTPException(status_code=400, detail="notebook_required") from e
        raise
    _try_enqueue_note_rag_index(note_id, user_ref)
    return {"success": True, "noteId": note_id}


@router.post("/notes/ask/hints")
def notes_ask_hints_api(body: NotesAskHintsRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    owner_sid = (body.shared_from_owner_user_id or "").strip() or None
    project_owner: str | None = None
    if owner_sid:
        if not get_shared_notebook_public_access(owner_sid, body.notebook.strip()):
            raise HTTPException(status_code=404, detail="notebook_not_shared")
        project_owner = owner_sid
    try:
        out = generate_notes_ask_hints(
            notebook=body.notebook.strip(),
            note_ids=body.note_ids,
            user_ref=user_ref,
            project_owner_user_uuid=project_owner,
        )
    except ValueError as e:
        msg = str(e)
        if msg == "note_not_found":
            raise HTTPException(status_code=404, detail=msg) from e
        if msg in ("notebook_required", "note_ids_required", "too_many_notes", "note_notebook_mismatch", "empty_context"):
            raise HTTPException(status_code=400, detail=msg) from e
        if msg in ("empty_hints", "hints_shape", "hints_suggestions", "hints_incomplete"):
            raise HTTPException(status_code=502, detail="hints_llm_output_invalid") from e
        raise HTTPException(status_code=502, detail=msg) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"success": True, **out}


@router.post("/notes/ask")
def notes_ask_api(body: NotesAskRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    owner_sid = (body.shared_from_owner_user_id or "").strip() or None
    project_owner: str | None = None
    if owner_sid:
        if not get_shared_notebook_public_access(owner_sid, body.notebook.strip()):
            raise HTTPException(status_code=404, detail="notebook_not_shared")
        project_owner = owner_sid
    try:
        out = answer_notes_question(
            notebook=body.notebook.strip(),
            note_ids=body.note_ids,
            question=body.question.strip(),
            user_ref=user_ref,
            project_owner_user_uuid=project_owner,
        )
    except ValueError as e:
        msg = str(e)
        if msg == "note_not_found":
            raise HTTPException(status_code=404, detail=msg) from e
        if msg in (
            "notebook_required",
            "question_required",
            "note_ids_required",
            "too_many_notes",
            "note_notebook_mismatch",
        ):
            raise HTTPException(status_code=400, detail=msg) from e
        raise HTTPException(status_code=400, detail=msg) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"success": True, **out}


@router.post("/notes/ask/stream")
def notes_ask_stream_api(body: NotesAskRequest, request: Request):
    """基于已选笔记的问答：SSE，`data:` JSON 行，事件 type 为 chunk | done | error。"""
    user_ref = _current_user_ref_or_401(request)
    owner_sid = (body.shared_from_owner_user_id or "").strip() or None
    project_owner: str | None = None
    if owner_sid:
        if not get_shared_notebook_public_access(owner_sid, body.notebook.strip()):
            raise HTTPException(status_code=404, detail="notebook_not_shared")
        project_owner = owner_sid
    try:
        prepared = _prepare_notes_ask_messages(
            notebook=body.notebook.strip(),
            note_ids=body.note_ids,
            question=body.question.strip(),
            user_ref=user_ref,
            project_owner_user_uuid=project_owner,
        )
    except ValueError as e:
        msg = str(e)
        if msg == "note_not_found":
            raise HTTPException(status_code=404, detail=msg) from e
        if msg in (
            "notebook_required",
            "question_required",
            "note_ids_required",
            "too_many_notes",
            "note_notebook_mismatch",
        ):
            raise HTTPException(status_code=400, detail=msg) from e
        raise HTTPException(status_code=400, detail=msg) from e

    def gen():
        for ev in iter_notes_answer_events(
            notebook=body.notebook.strip(),
            note_ids=body.note_ids,
            question=body.question.strip(),
            user_ref=user_ref,
            prepared_messages_sources=prepared,
            project_owner_user_uuid=project_owner,
        ):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.patch("/notes/{note_id}")
def patch_note_api(note_id: str, body: NotePatchRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    ok = update_note_title(note_id, body.title.strip(), user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    row = get_note_by_id(note_id, user_ref=user_ref)
    return JSONResponse(jsonable_encoder({"success": True, "note": row}))


@router.get("/notes/{note_id}/preview_text")
def preview_note_text_api(
    note_id: str,
    request: Request,
    shared_from_owner_user_id: str | None = Query(default=None, alias="sharedFromOwnerUserId"),
):
    sid = (shared_from_owner_user_id or "").strip() or None
    user_ref = _optional_user_ref(request) if sid else _current_user_ref_or_401(request)
    if sid:
        row = get_note_by_id(note_id, user_ref=user_ref, project_owner_user_uuid=sid)
        if not row:
            row = get_note_by_id(note_id, include_deleted=True, user_ref=user_ref, project_owner_user_uuid=sid)
        if row:
            nb = _metadata_notebook_from_row(row)
            if not get_shared_notebook_public_access(sid, nb):
                raise HTTPException(status_code=404, detail="notebook_not_shared")
    else:
        row = get_note_by_id(note_id, user_ref=user_ref)
        if not row:
            row = get_note_by_id(note_id, include_deleted=True, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    title = str(md.get("title") or note_id).strip()
    ext = str(md.get("ext") or "").strip().lower()
    text = str(row.get("content_text") or "")
    truncated = False
    if len(text) > NOTE_PREVIEW_TEXT_MAX:
        text = text[:NOTE_PREVIEW_TEXT_MAX]
        truncated = True
    rag_n = count_rag_chunks_for_notes([str(note_id)])
    p_st = str(md.get("parseStatus") or "").strip()
    p_de = str(md.get("parseDetail") or "").strip()
    return {
        "success": True,
        "noteId": note_id,
        "title": title,
        "text": text,
        "truncated": truncated,
        "ext": ext,
        "ragChunkCount": rag_n,
        "ragIndexError": str(row.get("note_rag_index_error") or "").strip(),
        "ragIndexedAt": str(row.get("note_rag_index_at") or ""),
        "parseStatus": p_st,
        "parseEngine": str(md.get("parseEngine") or "").strip(),
        "parseDetail": p_de,
        "parseEncoding": str(md.get("parseEncoding") or "").strip(),
        "parseOk": p_st == "ok" if p_st else True,
    }


@router.get("/notes/{note_id}/file")
def download_note_file_api(
    note_id: str,
    request: Request,
    shared_from_owner_user_id: str | None = Query(default=None, alias="sharedFromOwnerUserId"),
):
    sid = (shared_from_owner_user_id or "").strip() or None
    user_ref = _optional_user_ref(request) if sid else _current_user_ref_or_401(request)
    if sid:
        row = get_note_by_id(note_id, user_ref=user_ref, project_owner_user_uuid=sid)
        if not row:
            row = get_note_by_id(note_id, include_deleted=True, user_ref=user_ref, project_owner_user_uuid=sid)
        if row:
            nb = _metadata_notebook_from_row(row)
            if not get_shared_notebook_public_access(sid, nb):
                raise HTTPException(status_code=404, detail="notebook_not_shared")
    else:
        row = get_note_by_id(note_id, user_ref=user_ref)
        if not row:
            row = get_note_by_id(note_id, include_deleted=True, user_ref=user_ref)
    if not row or str(row.get("input_type") or "") != "note_file":
        raise HTTPException(status_code=404, detail="note_not_found")
    key = str(row.get("file_object_key") or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="file_missing")
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    ext = str(md.get("ext") or "").strip().lower()
    data = get_object_bytes(key)
    fn = str(md.get("original_filename") or f"note.{ext or 'bin'}")
    return Response(
        content=data,
        media_type=_mime_for_note_ext(ext),
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@router.post("/notes/upload_json")
def upload_note_json_api(body: NoteUploadJsonRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="文件数据无效")
    raw_name = (body.filename or "").strip()
    title = (body.title or "").strip()
    notebook = (body.notebook or "").strip()
    project_name = (body.project_name or NOTES_PODCAST_STUDIO_PROJECT).strip() or NOTES_PODCAST_STUDIO_PROJECT
    return _persist_note_upload(user_ref, data, raw_name, title, notebook, project_name)


@router.post("/notes/upload_raw")
async def upload_note_raw_api(
    request: Request,
    notebook: str = Query(...),
    filename: str = Query(...),
    title: str = Query(default=""),
    project_name: str = Query(default=NOTES_PODCAST_STUDIO_PROJECT),
):
    """BFF 二进制转发：body 为原始文件字节，元数据在 query（避免对整段 multipart 做内部签名）。"""
    user_ref = _current_user_ref_or_401(request)
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")
    fname = (filename or "").strip()
    pn = (project_name or NOTES_PODCAST_STUDIO_PROJECT).strip() or NOTES_PODCAST_STUDIO_PROJECT
    return _persist_note_upload(
        user_ref,
        data,
        fname,
        (title or "").strip(),
        (notebook or "").strip(),
        pn,
    )


@router.post("/notes/import_url")
def import_note_from_url_api(body: NoteImportUrlRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="请提供 URL")
    fetch = content_parser.parse_url(url)
    content = str(fetch.get("content") or "").strip()
    if not fetch.get("success") or not content:
        hint = str(fetch.get("hint") or "").strip() or actionable_hint_for_failed_url(
            url,
            error_code=str(fetch.get("error_code") or "").strip() or None,
            upstream_error=str(fetch.get("error") or "").strip() or None,
        )
        head = str(fetch.get("error") or "").strip() or "未能从网页提取正文"
        raise HTTPException(status_code=400, detail=f"{head}\n\n{hint}")
    if len(content) > MAX_URL_IMPORT_CHARS:
        content = content[:MAX_URL_IMPORT_CHARS] + "\n\n（内容已截断）"
    notebook = (body.notebook or "").strip()
    if not notebook:
        raise HTTPException(status_code=400, detail="notebook_required")
    custom_title = (body.title or "").strip()
    if custom_title:
        title = custom_title
    else:
        pu = urlparse(url)
        host = (pu.netloc or "").strip()
        title = f"{host} 摘录" if host else "网页笔记"
    project_id = ensure_default_project(body.project_name, created_by=user_ref)
    try:
        note_id = create_text_note(
            project_id=project_id,
            title=title,
            notebook=notebook,
            content=content,
            source_url=url,
            user_ref=user_ref,
        )
    except ValueError as e:
        if str(e) == "notebook_required":
            raise HTTPException(status_code=400, detail="notebook_required") from e
        raise
    _try_enqueue_note_rag_index(note_id, user_ref)
    return {"success": True, "noteId": note_id, "title": title, "notebook": notebook}


@router.delete("/notes/{note_id}")
def delete_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    ok = delete_note(note_id, user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    return {"success": True, "noteId": note_id, "moved_to_trash": True}


@router.post("/notes/{note_id}/restore")
def restore_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    ok = restore_note(note_id, user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    return {"success": True, "noteId": note_id}


@router.delete("/notes/{note_id}/purge")
def purge_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    ok = purge_note_hard(note_id, user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    return {"success": True, "noteId": note_id}


@router.get("/notebooks")
def list_notebooks_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    migrate_legacy_default_notebook_for_user(user_ref)
    ensure_default_library_notebook(user_ref)
    names = list_notebook_names(user_ref=user_ref)
    ordered = sorted(set(names), key=lambda x: x)
    sharing = list_user_notebook_sharing_meta(user_ref)
    covers = list_notebook_covers_meta(user_ref)
    return {"success": True, "notebooks": ordered, "notebookSharing": sharing, "notebookCovers": covers}


@router.get("/notebooks/popular")
def list_popular_notebooks_api(
    request: Request,
    limit: int = Query(default=40, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10_000),
):
    _current_user_ref_or_401(request)
    items = list_popular_public_notebooks(limit=limit, offset=offset)
    has_more = len(items) >= limit
    return {"success": True, "items": items, "has_more": has_more, "offset": offset, "limit": limit}


@router.post("/notebooks")
def create_notebook_api(body: NotebookCreateRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    ok, msg = create_notebook_only(body.name.strip(), user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    ensure_default_library_notebook(user_ref)
    return {"success": True, "name": msg}


@router.post("/notebooks/view")
def increment_notebook_view_api(body: NotebookViewIncrementRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    owner = body.owner_user_id.strip()
    nb = body.notebook.strip()
    if not get_shared_notebook_public_access(owner, nb):
        raise HTTPException(status_code=404, detail="notebook_not_shared")
    if not increment_public_notebook_view(owner, nb, viewer_user_ref=user_ref):
        raise HTTPException(status_code=400, detail="view_increment_failed")
    return {"success": True}


@router.get("/notebooks/cover-public")
def get_notebook_cover_public_api(
    request: Request,
    owner_user_id: str = Query(..., min_length=10, max_length=80, alias="ownerUserId"),
    notebook: str = Query(..., min_length=1, max_length=200),
    variant: str = Query(default="thumb"),
):
    del request
    data, mime, err = read_notebook_cover_bytes_public(
        None, owner_user_id.strip(), notebook.strip(), variant.strip().lower()
    )
    if err or not data:
        raise HTTPException(status_code=404, detail=err or "cover_not_found")
    return Response(content=data, media_type=mime or "application/octet-stream")


@router.patch("/notebooks/{notebook_name:path}/share")
def patch_notebook_share_api(notebook_name: str, body: NotebookSharingPatchRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    pa = (body.public_access or "").strip().lower() if body.public_access else None
    ok, err = set_notebook_sharing(
        user_ref,
        notebook_name.strip(),
        is_public=bool(body.is_public),
        public_access=pa,
        listed_in_discover=body.listed_in_discover,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    nb = notebook_name.strip()
    row = get_notebook_sharing_row(user_ref, nb)
    listed = bool((row or {}).get("listed_in_discover")) if row else False
    return {
        "success": True,
        "name": nb,
        "isPublic": body.is_public,
        "publicAccess": pa,
        "listedInDiscover": listed,
    }


@router.get("/notebooks/{notebook_name:path}/cover")
def get_notebook_cover_owner_api(
    notebook_name: str,
    request: Request,
    variant: str = Query(default="thumb"),
):
    user_ref = _current_user_ref_or_401(request)
    data, mime, err = read_notebook_cover_bytes_owner(
        user_ref, notebook_name.strip(), (variant or "thumb").strip().lower()
    )
    if err or not data:
        raise HTTPException(status_code=404, detail=err or "cover_not_found")
    return Response(content=data, media_type=mime or "application/octet-stream")


@router.post("/notebooks/{notebook_name:path}/cover")
async def upload_notebook_cover_api(notebook_name: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    data = await request.body()
    ct = request.headers.get("content-type")
    ok, err = upload_notebook_cover_db(user_ref, notebook_name.strip(), data, ct)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {"success": True, "name": notebook_name.strip()}


@router.patch("/notebooks/{notebook_name:path}")
def patch_notebook_api(notebook_name: str, body: NotebookPatchRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    nb0 = notebook_name.strip()
    changed_rename = False
    if body.new_name is not None:
        new_n = body.new_name.strip()
        ok, err = rename_notebook_db(nb0, new_n, user_ref=user_ref)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
        nb0 = new_n
        changed_rename = True
    if body.cover_mode is not None:
        ok, err = patch_notebook_cover_db(
            user_ref, nb0, cover_mode=body.cover_mode.strip().lower(), cover_preset_id=body.cover_preset_id
        )
        if not ok:
            raise HTTPException(status_code=400, detail=err)
    out: dict[str, object] = {"success": True, "name": nb0}
    if changed_rename and body.new_name is not None:
        out["old"] = notebook_name.strip()
        out["new"] = nb0
    return out


@router.delete("/notebooks/{notebook_name:path}")
def delete_notebook_api(notebook_name: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    ok, err, notes_purged, jobs_trashed = delete_notebook_db(notebook_name.strip(), user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "name": notebook_name.strip(),
        "deletedCount": notes_purged,
        "trashedJobsCount": jobs_trashed,
    }


def ensure_notebooks_schema_startup(*, strict: bool = False) -> None:
    try:
        ensure_notebooks_schema()
        ensure_note_rag_schema()
        purge_expired_trashed_notes(retention_days=NOTE_TRASH_RETENTION_DAYS, max_rows=settings.trash_purge_max_rows)
    except Exception:
        _notes_startup_logger.exception("notebooks schema startup failed")
        if strict:
            raise
