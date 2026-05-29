import base64
import hashlib
import io
import json
import zipfile
import logging
import os
import re
import time
import uuid
import unicodedata
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import psycopg2
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..config import settings
from ..fyv_shared.content_parser import content_parser
from ..note_user_hints import (
    attach_hint_actions_to_upload_result,
    format_import_url_http_detail,
    hint_actions_for_code,
)
from ..url_fetch_hints import actionable_hint_for_failed_url
from ..note_constants import (
    ALLOWED_NOTE_EXT,
    VIDEO_NOTE_EXT,
    LONG_DOC_IMPORT_WARN_CHARS,
    MAX_NOTE_UPLOAD_BYTES,
    NOTE_PREVIEW_TEXT_MAX,
)
from ..note_chapters import note_coverage_stats
from ..models import (
    NOTES_PODCAST_STUDIO_PROJECT,
    aggregate_notebook_input_stats,
    count_distinct_notebooks_for_user,
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
    purge_notes_hard_batch,
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
from ..note_document_extract import NoteParseResult
from ..note_parse_quality import page_breaks_from_segments
from ..object_store import delete_object_key, get_object_bytes, upload_bytes
from ..notes_ask import (
    _prepare_notes_ask_messages,
    answer_notes_question,
    generate_notes_ask_hints,
    iter_notes_answer_events,
    notes_ask_value_error_sse_event,
)
from ..note_rag_service import (
    clear_note_rag_index_error,
    count_rag_chunks_for_notes,
    ensure_note_rag_schema,
    invalidate_retrieval_cache_for_notes,
    set_note_rag_index_error,
)
from ..note_style_features import parse_style_features, style_features_match_hash
from ..text_decode import safe_decode_bytes
from ..schemas import (
    NoteCreateRequest,
    NoteImportUrlRequest,
    NotePatchRequest,
    NoteUploadJsonRequest,
    NotebookCreateRequest,
    NotebookPatchRequest,
    NotebookSharingPatchRequest,
    NotesAskHintsRequest,
    NotesAskRequest,
)

_notes_startup_logger = logging.getLogger(__name__)
from ..security import verify_internal_signature

router = APIRouter(prefix="/api/v1", tags=["notes"], dependencies=[Depends(verify_internal_signature)])
NOTE_TRASH_RETENTION_DAYS = settings.trash_retention_days
UPLOAD_DEBUG_MODE = (os.getenv("UPLOAD_DEBUG_MODE") or "").strip().lower() in ("1", "true", "yes", "on")
_notebooks_schema_ready = False


def _ensure_notebooks_schema_once() -> None:
    global _notebooks_schema_ready
    if _notebooks_schema_ready:
        return
    ensure_notebooks_schema()
    _notebooks_schema_ready = True


def _upload_diag(event: str, **fields: object) -> None:
    if not UPLOAD_DEBUG_MODE:
        return
    payload: dict[str, object] = {"event": event}
    for k, v in fields.items():
        if v is None:
            continue
        if isinstance(v, (bytes, bytearray)):
            payload[k] = f"<bytes:{len(v)}>"
        elif isinstance(v, str):
            payload[k] = v[:220]
        elif isinstance(v, (int, float, bool)):
            payload[k] = v
        elif isinstance(v, (list, tuple)):
            payload[k] = f"<list:{len(v)}>"
        elif isinstance(v, dict):
            payload[k] = f"<dict:{len(v)}>"
        else:
            payload[k] = str(v)[:220]
    try:
        _notes_startup_logger.warning("upload_diag %s", json.dumps(payload, ensure_ascii=False))
    except Exception:
        _notes_startup_logger.warning("upload_diag event=%s fields=%s", event, list(payload.keys()))


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


def _safe_user_text(value: str | None, *, max_len: int = 500) -> str:
    """清理异常 Unicode 输入，避免下游解码/序列化失败。"""
    raw = str(value or "")
    try:
        normalized = unicodedata.normalize("NFC", raw)
    except Exception:
        normalized = raw
    safe = normalized.encode("utf-8", errors="ignore").decode("utf-8", errors="ignore")
    safe = safe.replace("\x00", "").strip()
    if len(safe) > max_len:
        safe = safe[:max_len].rstrip()
    return safe


def _query_param_lossy_utf8(request: Request, name: str, default: str = "") -> str:
    """
    直接从 ASGI 原始 query_string 解析参数，并以容错 UTF-8 解码。
    避免框架层对异常字节做严格 UTF-8 解码时报 UnicodeDecodeError。
    """
    query_raw = request.scope.get("query_string", b"")
    if not isinstance(query_raw, (bytes, bytearray)):
        return default
    needle = (name or "").strip().encode("ascii", errors="ignore")
    if not needle:
        return default
    for seg in bytes(query_raw).split(b"&"):
        if not seg:
            continue
        key_raw, sep, val_raw = seg.partition(b"=")
        if not sep:
            continue
        key = key_raw.replace(b"+", b" ")
        val = val_raw.replace(b"+", b" ")
        try:
            k_bytes = bytearray()
            i = 0
            while i < len(key):
                if key[i:i + 1] == b"%" and i + 2 < len(key):
                    try:
                        k_bytes.append(int(key[i + 1:i + 3], 16))
                        i += 3
                        continue
                    except ValueError:
                        pass
                k_bytes.extend(key[i:i + 1])
                i += 1
            if bytes(k_bytes).decode("ascii", errors="ignore") != name:
                continue
            v_bytes = bytearray()
            j = 0
            while j < len(val):
                if val[j:j + 1] == b"%" and j + 2 < len(val):
                    try:
                        v_bytes.append(int(val[j + 1:j + 3], 16))
                        j += 3
                        continue
                    except ValueError:
                        pass
                v_bytes.extend(val[j:j + 1])
                j += 1
            return bytes(v_bytes).decode("utf-8", errors="replace")
        except Exception:
            continue
    return default


def _raise_upload_unicode_error(stage: str, exc: UnicodeDecodeError) -> None:
    reason = str(exc).replace("\n", " ").strip()[:240]
    raise HTTPException(
        status_code=400,
        detail=f"invalid_text_encoding:{stage}:{reason}",
    ) from exc


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
        try:
            set_note_rag_index_error(note_id, f"enqueue_failed: {str(exc)[:220]}")
        except Exception:
            pass
        _notes_startup_logger.warning("note_rag_index enqueue failed note_id=%s: %s", note_id, exc)


def _try_enqueue_note_file_parse(note_id: str, user_ref: str | None) -> None:
    """异步：从对象存储解析附件正文（方案 B 阶段 2）。"""
    try:
        pid = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
        jid = create_job(pid, "note_file_parse", "ai", {"note_id": note_id}, user_ref)
        ai_queue.enqueue(run_ai_job, jid, job_timeout="20m")
    except Exception as exc:
        _notes_startup_logger.warning("note_file_parse enqueue failed note_id=%s: %s", note_id, exc)


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
        "csv": "text/csv; charset=utf-8",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "avif": "image/avif",
    }.get(e, "application/octet-stream")


def _display_ext_for_note(*, input_type: str, metadata: dict, source_url: str) -> str:
    """来源列表展示用扩展名：网页导入不再显示 txt。"""
    it = (input_type or "").strip()
    md_ext = str(metadata.get("ext") or "").strip().lower()
    if md_ext:
        return md_ext
    if it == "note_text":
        return "url" if (source_url or "").strip() else "txt"
    return ""


def _normalize_metadata_dict(row: dict) -> dict:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def _parse_error_code(parse_status: str, parse_detail: str, parse_engine: str) -> str:
    st = (parse_status or "").strip().lower()
    detail = (parse_detail or "").strip().lower()
    engine = (parse_engine or "").strip().lower()
    if not st:
        return ""
    if st == "ok":
        return ""
    if "扫描" in detail or "scanned" in detail:
        return "PARSE_SCANNED_PDF"
    if "ocr" in detail and "未配置" in detail:
        return "OCR_NOT_CONFIGURED"
    if "forbidden" in detail or "403" in detail:
        return "URL_FORBIDDEN_403"
    if "登录" in detail:
        return "URL_LOGIN_WALL"
    if st == "error":
        return "PARSE_ENGINE_ERROR" if engine else "PARSE_ERROR"
    if st == "empty":
        return "PARSE_EMPTY"
    return "PARSE_UNKNOWN"


def _sniff_openxml_container_kind(data: bytes) -> str | None:
    """区分 PK zip 容器：xlsx / docx / epub；无法识别时返回 None。"""
    if not data.startswith(b"PK\x03\x04"):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            names = set(zf.namelist())
    except Exception:
        return None
    if "xl/workbook.xml" in names or any(n.startswith("xl/worksheets/") for n in names):
        return "xlsx"
    if "word/document.xml" in names:
        return "docx"
    if "META-INF/container.xml" in names and any(n.endswith(".opf") for n in names):
        return "epub"
    return None


def _sniff_ext_from_bytes(data: bytes) -> str:
    b = data[:64]
    if b.startswith(b"%PDF-"):
        return "pdf"
    # OLE 复合文档：经典 .xls / .doc 等（仅凭魔数无法区分，由扩展名与解析器兜底）
    if len(data) >= 8 and data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "ole_compound"
    if b.startswith(b"PK\x03\x04"):
        return "zip_like"
    if len(b) >= 8 and b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if len(b) >= 3 and b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b.startswith(b"GIF87a") or b.startswith(b"GIF89a"):
        return "gif"
    if len(b) >= 12 and b[0:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if len(b) >= 12 and b[4:8] == b"ftyp":
        return "mp4_like"
    return ""


def _looks_like_text_payload(data: bytes) -> bool:
    if not data:
        return True
    sample = data[:4096]
    if b"\x00" in sample:
        return False
    printable = 0
    for c in sample:
        if c in (9, 10, 13) or 32 <= c <= 126:
            printable += 1
    ratio = printable / max(1, len(sample))
    return ratio >= 0.7


def _validate_upload_ext_matches_bytes(ext: str, data: bytes) -> None:
    sniff = _sniff_ext_from_bytes(data)
    e = (ext or "").lower().strip()
    if not sniff:
        if e in ("txt", "md", "markdown", "html", "htm", "xhtml") and not _looks_like_text_payload(data):
            raise HTTPException(status_code=400, detail="FILE_TYPE_MISMATCH:文本扩展名与二进制内容不一致")
        return
    if sniff == "ole_compound":
        if e not in ("doc", "xls"):
            raise HTTPException(
                status_code=400,
                detail="FILE_TYPE_MISMATCH:该二进制为 OLE 复合文档，扩展名仅支持 .doc 或 .xls",
            )
        return
    # zip 容器类：docx/epub/xlsx 共享 PK 签名，按内部结构校验。
    if sniff == "zip_like":
        kind = _sniff_openxml_container_kind(data)
        if e == "xlsx":
            if kind != "xlsx":
                raise HTTPException(
                    status_code=400,
                    detail="FILE_TYPE_MISMATCH:文件不是有效的 Excel 表格（.xlsx）",
                )
            return
        if e == "xls":
            raise HTTPException(
                status_code=400,
                detail="FILE_TYPE_MISMATCH:文件实为 Office Open XML（多为 .xlsx），请改用 .xlsx 扩展名上传",
            )
        if e == "docx":
            if kind != "docx":
                raise HTTPException(
                    status_code=400,
                    detail="FILE_TYPE_MISMATCH:文件不是有效的 Word 文档（.docx）",
                )
            return
        if e == "epub":
            if kind != "epub":
                raise HTTPException(
                    status_code=400,
                    detail="FILE_TYPE_MISMATCH:文件不是有效的 EPUB",
                )
            return
        raise HTTPException(status_code=400, detail="FILE_TYPE_MISMATCH:不支持的压缩容器格式")
    if sniff == "mp4_like" and e in VIDEO_NOTE_EXT:
        return
    allowed: dict[str, tuple[str, ...]] = {
        "pdf": ("pdf",),
        "png": ("png",),
        "jpg": ("jpg", "jpeg"),
        "gif": ("gif",),
        "webp": ("webp",),
    }
    exts = allowed.get(sniff)
    if exts and e not in exts:
        raise HTTPException(status_code=400, detail=f"FILE_TYPE_MISMATCH:{sniff}签名与扩展名不一致")


def _parse_error_code_for_upload(ext: str, parse_result: NoteParseResult) -> str:
    code = _parse_error_code(parse_result.status, parse_result.detail or "", parse_result.engine or "")
    if code and code != "PARSE_EMPTY":
        return code
    e = (ext or "").lower().strip()
    st = (parse_result.status or "").lower().strip()
    detail = (parse_result.detail or "").lower()
    if st == "ok":
        return ""
    if "ocr" in detail and "未配置" in detail:
        return "OCR_NOT_CONFIGURED"
    if e == "pdf":
        return "PARSE_SCANNED_PDF" if "扫描" in detail or "scanned" in detail else "PDF_TEXT_EMPTY"
    if e == "epub":
        return "EPUB_TEXT_EMPTY" if st == "empty" else "EPUB_PARSE_ERROR"
    if e == "docx":
        return "DOCX_TEXT_EMPTY" if st == "empty" else "DOCX_PARSE_ERROR"
    if e == "doc":
        if "antiword" in detail or "catdoc" in detail or "libreoffice" in detail:
            return "DOC_TOOL_MISSING"
        return "DOC_PARSE_ERROR"
    if e in ("txt", "md", "markdown"):
        return "TEXT_DECODE_EMPTY"
    if e in ("html", "htm", "xhtml"):
        return "HTML_TEXT_EMPTY"
    if e == "csv":
        return "CSV_PARSE_ERROR" if st == "error" else ("PARSE_EMPTY" if st == "empty" else "PARSE_ENGINE_ERROR")
    if e == "xlsx":
        return "XLSX_PARSE_ERROR" if st == "error" else ("PARSE_EMPTY" if st == "empty" else "PARSE_ENGINE_ERROR")
    if e == "xls":
        return "XLS_PARSE_ERROR" if st == "error" else ("PARSE_EMPTY" if st == "empty" else "PARSE_ENGINE_ERROR")
    return "PARSE_EMPTY" if st == "empty" else "PARSE_ENGINE_ERROR"


def _looks_like_xiaohongshu_shell_text(text: str) -> bool:
    body = (text or "").strip()
    if not body:
        return True
    markers = (
        "沪ICP备",
        "营业执照",
        "沪公网安备",
        "增值电信业务经营许可证",
        "互联网药品信息服务资格证书",
        "行吟信息科技（上海）有限公司",
        "地址：上海市黄浦区马当路",
        "发现\n直播\n发布\n通知",
    )
    hit = sum(1 for m in markers if m in body)
    has_paragraph_like = ("“" in body and "”" in body) or ("。" in body and len(body) >= 120)
    return hit >= 2 and not has_paragraph_like


def _url_parse_should_reject_low_quality(parse_meta: dict, content: str) -> tuple[bool, str]:
    try:
        score = float(parse_meta.get("quality_score") or 0.0)
    except Exception:
        score = 0.0
    reasons_raw = parse_meta.get("reason_codes")
    reasons = [str(x).strip() for x in reasons_raw] if isinstance(reasons_raw, list) else []
    reason_set = {r for r in reasons if r}
    body_len = len((content or "").strip())
    if score < 0.2:
        return True, "quality_very_low"
    if score < 0.3 and (
        "shell_page" in reason_set
        or "bot_verification" in reason_set
        or "dynamic_shell_page" in reason_set
        or "high_noise_ratio" in reason_set
        or "garbled_text" in reason_set
        or "feishu_lark_login_wall" in reason_set
        or body_len < 120
    ):
        return True, "quality_low_with_shell_signals"
    if "garbled_text" in reason_set:
        return True, "garbled_text"
    if "feishu_lark_login_wall" in reason_set:
        return True, "feishu_lark_shell"
    return False, ""


def _derive_source_capabilities(
    *,
    input_type: str,
    content_text: str,
    parse_status: str,
    parse_detail: str,
    parse_engine: str,
    rag_chunks: int,
    rag_err: str,
    created_at: str,
    rag_index_at: str,
    metadata_parse_state: str = "",
    has_file_object: bool = False,
) -> dict[str, object]:
    mps = (metadata_parse_state or "").strip().lower()
    if mps in ("pending", "parsing"):
        return {
            "parseOk": False,
            "parseState": mps,
            "parseErrorCode": "",
            "citeState": "unavailable",
            "retrieveState": "not_ready",
            "sourceReady": has_file_object,
            "sourceHint": "正在解析正文，可先下载原文件",
        }
    ct = (content_text or "").strip()
    p_st = (parse_status or "").strip().lower()
    parse_ok = p_st == "ok" if p_st else (input_type == "note_text" and bool(ct)) or (input_type == "note_file" and len(ct) >= 20)
    parse_state = "success" if parse_ok else ("failed" if p_st in ("error", "empty") else "partial")
    parse_error_code = _parse_error_code(parse_status, parse_detail, parse_engine)

    # 可引用：有可用正文即可在回答中做 [n] 引用；正文极短时降级为 limited
    if not parse_ok:
        cite_state = "unavailable"
    elif len(ct) < 120:
        cite_state = "limited"
    else:
        cite_state = "ready"

    if rag_err:
        retrieve_state = "failed"
    elif rag_chunks > 0:
        retrieve_state = "indexed"
    elif parse_ok:
        retrieve_state = "indexing"
    else:
        retrieve_state = "not_ready"

    idx_timeout = False
    if retrieve_state == "indexing":
        t_raw = (created_at or "").strip()
        if t_raw:
            try:
                ts = datetime.fromisoformat(t_raw.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                age_sec = (datetime.now(timezone.utc) - ts).total_seconds()
                if age_sec >= 20 * 60:
                    idx_timeout = True
            except Exception:
                idx_timeout = False
        if idx_timeout and not (rag_index_at or "").strip():
            retrieve_state = "failed"

    if parse_ok and retrieve_state == "indexed":
        source_ready = True
        source_hint = "解析完成、可引用、可检索"
    elif parse_ok and retrieve_state in ("indexing", "not_ready"):
        source_ready = True
        source_hint = "正文可用；索引构建中"
    else:
        source_ready = False
        source_hint = "索引长时间未完成，请稍后重试或重新上传来源触发重建" if idx_timeout else "正文未就绪或解析失败，建议预览后重传"

    return {
        "parseOk": parse_ok,
        "parseState": parse_state,
        "parseErrorCode": parse_error_code,
        "citeState": cite_state,
        "retrieveState": retrieve_state,
        "sourceReady": source_ready,
        "sourceHint": source_hint,
    }


def _derive_preprocess_stage(md: dict, cap: dict[str, object]) -> tuple[str, str]:
    """
    预处理阶段拆分（展示口径）：
    解析中 / 摘要中 / 实体提取中 / 索引中 / 可问答
    """
    parse_ok = bool(cap.get("parseOk"))
    retrieve_state = str(cap.get("retrieveState") or "")
    parse_err_code = str(cap.get("parseErrorCode") or "")
    cap_parse_state = str(cap.get("parseState") or "").strip().lower()
    if cap_parse_state in ("pending", "parsing"):
        return "解析中", str(cap.get("sourceHint") or "正在后台解析正文，请稍后刷新。")
    if not parse_ok:
        if parse_err_code:
            return "解析中", f"解析未成功（{parse_err_code}）：建议重传文本版来源（txt/md/html）或检查原文件质量。"
        return "解析中", "请等待解析完成；若长时间未完成，可重传为 txt/md/html 或检查原文件质量。"
    summary = str(md.get("preprocessSummary") or "").strip()
    tags = md.get("preprocessTags") if isinstance(md.get("preprocessTags"), list) else []
    ents = md.get("preprocessEntities") if isinstance(md.get("preprocessEntities"), list) else []
    if not summary:
        return "摘要中", "正在生成结构化摘要，请稍后刷新。"
    if not ents:
        return "实体提取中", "正在抽取关键实体（人名/机构/术语），请稍后刷新。"
    if retrieve_state != "indexed":
        if retrieve_state == "failed":
            return "索引中", "索引失败：可稍后重试，或重新上传来源以触发重建。"
        return "索引中", "正在建立检索索引，完成后可问答。"
    if not tags:
        return "索引中", "标签仍在补全中，索引已可用。"
    return "可问答", "来源已就绪，可直接提问。"


def _build_preprocess_fields(text: str) -> dict[str, object]:
    """轻量预处理：结构化摘要 + 主题标签 + 关键实体。"""
    body = (text or "").strip()
    if not body:
        return {"preprocessStatus": "empty", "preprocessSummary": "", "preprocessTags": [], "preprocessEntities": []}
    summary = body[:220] + ("…" if len(body) > 220 else "")
    token_pat = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,6}")
    stop = {"我们", "你们", "他们", "这个", "那个", "以及", "如果", "但是", "因为", "所以", "可以", "已经"}
    freq: dict[str, int] = {}
    for m in token_pat.finditer(body[:8000]):
        tok = m.group(0).strip().lower()
        if not tok or tok in stop:
            continue
        freq[tok] = freq.get(tok, 0) + 1
    tags = [k for k, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:8]]
    ent_pat = re.compile(r"(?:[A-Z][a-zA-Z]{1,}|[\u4e00-\u9fff]{2,8})(?:公司|集团|大学|研究院|平台|系统)?")
    entities: list[str] = []
    seen: set[str] = set()
    for m in ent_pat.finditer(body[:6000]):
        val = m.group(0).strip()
        if len(val) < 2 or val in seen:
            continue
        seen.add(val)
        entities.append(val)
        if len(entities) >= 12:
            break
    return {
        "preprocessStatus": "ready",
        "preprocessSummary": summary,
        "preprocessTags": tags,
        "preprocessEntities": entities,
    }


def _build_structured_blocks_from_text(text: str) -> list[dict[str, object]]:
    """为纯文本来源生成结构块；有标题时保留目录层级，无标题时按段落建块。"""
    lines = [ln.rstrip() for ln in str(text or "").split("\n")]
    blocks: list[dict[str, object]] = []
    para: list[str] = []
    idx = 0

    def flush_para() -> None:
        nonlocal idx, para
        if not para:
            return
        body = " ".join([x.strip() for x in para if x.strip()]).strip()
        para = []
        if not body:
            return
        if len(body) > 260:
            parts = [p.strip() for p in re.split(r"(?<=[。！？.!?；;])\s*", body) if p.strip()]
            if len(parts) > 1:
                merged = ""
                for p in parts:
                    nxt = f"{merged} {p}".strip() if merged else p
                    if len(nxt) >= 180:
                        idx += 1
                        blocks.append({"id": f"text-{idx}", "type": "paragraph", "text": nxt})
                        merged = ""
                    else:
                        merged = nxt
                if merged:
                    idx += 1
                    blocks.append({"id": f"text-{idx}", "type": "paragraph", "text": merged})
                return
        idx += 1
        blocks.append({"id": f"text-{idx}", "type": "paragraph", "text": body})

    for raw in lines:
        s = raw.strip()
        if not s:
            flush_para()
            continue
        hm = re.match(r"^(#{1,3})\s+(.+)$", s)
        if hm:
            flush_para()
            idx += 1
            blocks.append({
                "id": f"text-{idx}",
                "type": "heading",
                "level": len(hm.group(1)),
                "text": hm.group(2).strip(),
            })
            continue
        if re.match(r"^(\- |\* |\d+\.\s+)", s):
            flush_para()
            idx += 1
            blocks.append({"id": f"text-{idx}", "type": "list_item", "text": s})
            continue
        if s.startswith("|"):
            flush_para()
            idx += 1
            blocks.append({"id": f"text-{idx}", "type": "table_row", "text": s})
            continue
        para.append(s)
    flush_para()
    return blocks[:800]


def _coerce_structured_blocks(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, object]] = []
    for item in value[:1000]:
        if not isinstance(item, dict):
            continue
        txt = str(item.get("text") or "").strip()
        typ = str(item.get("type") or "").strip() or "paragraph"
        if not txt:
            continue
        row: dict[str, object] = {
            "id": str(item.get("id") or f"blk-{len(out) + 1}"),
            "type": typ,
            "text": txt,
        }
        lv = item.get("level")
        if isinstance(lv, int) and 1 <= lv <= 6:
            row["level"] = lv
        out.append(row)
    return out


def _estimate_word_count(text: str) -> int:
    """
    统一字数口径：
    - 中文按单字计数
    - 英文/数字按词计数
    """
    body = (text or "").strip()
    if not body:
        return 0
    cjk_n = len(re.findall(r"[\u4e00-\u9fff]", body))
    latin_token_n = len(re.findall(r"[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*", body))
    return cjk_n + latin_token_n


def _persist_note_upload(
    user_ref: str | None,
    data: bytes,
    raw_name: str,
    title_in: str,
    notebook: str,
    project_name: str,
) -> dict:
    """写入对象存储、解析正文、落库；供 upload_json 与 upload_raw 共用。"""
    _upload_diag(
        "persist_start",
        user_ref=bool((user_ref or "").strip()),
        raw_name=raw_name,
        notebook=notebook,
        project_name=project_name,
        data_len=len(data),
    )
    try:
        _ensure_notebooks_schema_once()
    except Exception as exc:
        _notes_startup_logger.exception("notes upload: ensure_notebooks_schema failed")
        raise HTTPException(status_code=503, detail="笔记存储未就绪，请稍后重试。") from exc
    raw_name = _safe_user_text(raw_name, max_len=240)
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
    _validate_upload_ext_matches_bytes(ext, data)
    original_title = raw_name.rsplit(".", 1)[0].strip() if "." in raw_name else raw_name
    title = _safe_user_text(title_in, max_len=240) or original_title or raw_name
    notebook = _safe_user_text(notebook, max_len=120)
    if not notebook:
        raise HTTPException(status_code=400, detail="notebook_required")
    project_name = _safe_user_text(project_name, max_len=120) or NOTES_PODCAST_STUDIO_PROJECT
    content_sha256 = hashlib.sha256(data).hexdigest()
    try:
        project_id = ensure_default_project(project_name, created_by=user_ref)
        _upload_diag("persist_project_ok", project_id=project_id)
    except UnicodeDecodeError as exc:
        _raise_upload_unicode_error("ensure_default_project", exc)
    try:
        dup_id = find_duplicate_file_note_id(
            project_id,
            notebook,
            content_sha256=content_sha256,
            original_filename=raw_name,
            size=len(data),
        )
    except UnicodeDecodeError as exc:
        _raise_upload_unicode_error("find_duplicate_file_note_id", exc)
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
            p_code = str(md.get("parseErrorCode") or "").strip()[:80]
            p_ms = int(md.get("parseDurationMs") or 0)
            p_chars = int(md.get("parseTextChars") or 0)
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
                    "errorCode": p_code,
                    "durationMs": p_ms,
                    "textChars": p_chars,
                },
            }
            if parse_empty:
                out_dup["parseEmpty"] = True
            mps_dup = str(md.get("parseState") or "").strip().lower()
            if mps_dup in ("pending", "parsing") or parse_empty:
                _try_enqueue_note_file_parse(dup_id, user_ref)
            return attach_hint_actions_to_upload_result(out_dup)
    note_id = f"note_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    owner_uuid = resolved_user_uuid_string(user_ref)
    object_key = note_upload_object_key(note_id, ext, owner_uuid)
    try:
        upload_bytes(object_key, data, content_type=_mime_for_note_ext(ext))
        _upload_diag("persist_object_upload_ok", object_key=object_key, ext=ext, data_len=len(data))
    except Exception as exc:
        _notes_startup_logger.exception("notes upload: object store upload failed")
        raise HTTPException(
            status_code=503,
            detail="文件暂无法上传到存储，请确认对象存储可用后重试。",
        ) from exc
    extra_meta: dict[str, object] = {
        "parseState": "pending",
        "parseStatus": "pending",
        "parseEngine": "",
        "parseDurationMs": 0,
        "parseTextChars": 0,
        "contentSha256": content_sha256,
        "preprocessStatus": "empty",
        "preprocessSummary": "",
        "preprocessTags": [],
        "preprocessEntities": [],
    }
    try:
        row_id = create_file_note(
            project_id=project_id,
            title=title,
            notebook=notebook,
            content_text="",
            file_object_key=object_key,
            ext=ext,
            original_filename=raw_name,
            size=len(data),
            source_url=None,
            user_ref=user_ref,
            extra_metadata=extra_meta,
        )
        _upload_diag("persist_db_insert_ok", note_id=row_id, parse_state="pending")
    except UnicodeDecodeError as exc:
        delete_object_key(object_key)
        _raise_upload_unicode_error("create_file_note", exc)
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
    _try_enqueue_note_file_parse(row_id, user_ref)
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
            "status": "pending",
            "engine": "",
            "detail": "正文将在后台解析",
            "encoding": "",
            "errorCode": "",
            "durationMs": 0,
            "textChars": 0,
            "parseState": "pending",
        },
    }
    return attach_hint_actions_to_upload_result(out)


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
        md = _normalize_metadata_dict(r)
        notebook_name = str(md.get("notebook") or "").strip()
        try:
            from ..author_ip_store import is_author_ip_notebook_name

            if is_author_ip_notebook_name(notebook_name):
                continue
        except Exception:
            pass
        it = str(r.get("input_type") or "")
        src_url = str(r.get("source_url") or md.get("sourceUrl") or "")
        ext = _display_ext_for_note(input_type=it, metadata=md, source_url=src_url)
        note_uuid = str(r.get("id"))
        file_key = r.get("file_object_key")
        ct = str(r.get("content_text") or "").strip()
        rag_err = r.get("note_rag_index_error")
        rag_chunks = int(r.get("rag_chunk_count") or 0)
        p_st = str(md.get("parseStatus") or "").strip()
        p_eng = str(md.get("parseEngine") or "").strip()
        p_de = str(md.get("parseDetail") or "").strip()
        explicit_parse_error_code = str(md.get("parseErrorCode") or "").strip()
        mps = str(md.get("parseState") or "").strip()
        cap = _derive_source_capabilities(
            input_type=it,
            content_text=ct,
            parse_status=p_st,
            parse_detail=p_de,
            parse_engine=p_eng,
            rag_chunks=rag_chunks,
            rag_err=(str(rag_err).strip() if rag_err else ""),
            created_at=str(r.get("created_at") or ""),
            rag_index_at=str(r.get("note_rag_index_at") or ""),
            metadata_parse_state=mps,
            has_file_object=bool(file_key),
        )
        parse_err_final = explicit_parse_error_code or str(cap.get("parseErrorCode") or "").strip()
        parse_hint_actions = hint_actions_for_code(parse_err_final)
        rag_hash = str(r.get("note_rag_body_hash") or "").strip()
        sf = parse_style_features(md)
        notes.append(
            {
                "noteId": note_uuid,
                "title": str(md.get("title") or "未命名笔记"),
                "notebook": str(md.get("notebook") or ""),
                "ext": ext or "txt",
                "relativePath": f"/api/notes/{note_uuid}/file" if file_key else "",
                "createdAt": str(r.get("created_at") or ""),
                "sourceUrl": src_url,
                "inputType": it,
                "sourceReady": bool(cap["sourceReady"]),
                "sourceHint": str(cap["sourceHint"] or ""),
                "parseHintActions": parse_hint_actions,
                "ragChunkCount": rag_chunks,
                "noteRagBodyHash": rag_hash,
                "noteSummary": str(r.get("note_summary") or "").strip(),
                "styleFeaturesReady": bool(rag_hash and style_features_match_hash(sf, rag_hash)),
                "ragIndexError": (str(rag_err).strip() if rag_err else ""),
                "ragIndexedAt": str(r.get("note_rag_index_at") or ""),
                "parseStatus": p_st,
                "parseEngine": p_eng,
                "parseDetail": p_de,
                "parseEncoding": str(md.get("parseEncoding") or "").strip(),
                "parseOk": bool(cap["parseOk"]),
                "parseState": str(cap["parseState"] or ""),
                "parseErrorCode": explicit_parse_error_code or str(cap["parseErrorCode"] or ""),
                "citeState": str(cap["citeState"] or ""),
                "retrieveState": str(cap["retrieveState"] or ""),
                "preprocessStatus": str(md.get("preprocessStatus") or ""),
                "preprocessSummary": str(md.get("preprocessSummary") or ""),
                "preprocessTags": md.get("preprocessTags") if isinstance(md.get("preprocessTags"), list) else [],
                "preprocessEntities": md.get("preprocessEntities")
                if isinstance(md.get("preprocessEntities"), list)
                else [],
                "parseGate": str(md.get("parseGate") or ""),
                "parseQuality": md.get("parseQuality") if isinstance(md.get("parseQuality"), dict) else {},
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


@router.get("/notes/metrics")
def notes_metrics_api(request: Request):
    """首页工作台：当前用户下非空笔记本名去重数量。"""
    user_ref = _current_user_ref_or_401(request)
    n = count_distinct_notebooks_for_user(user_ref=user_ref)
    return {"success": True, "notebookCount": n}


@router.get("/notes/trash")
def list_trash_notes_api(
    request: Request,
    limit: int = Query(default=40, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=50_000),
    tab: str | None = Query(default=None, description="reference"),
):
    user_ref = _current_user_ref_or_401(request)
    tab_norm = str(tab or "").strip().lower()
    try:
        from ..author_ip_store import author_ip_display_name_map, note_is_author_ip_material
    except Exception:
        author_ip_display_name_map = lambda _u: {}  # type: ignore[assignment]
        note_is_author_ip_material = lambda _m, _n: False  # type: ignore[assignment]
    ip_names = author_ip_display_name_map(user_ref)
    fetch_limit = min(500, max(limit * 4, limit + 20)) if tab_norm == "reference" else limit
    rows = list_trashed_notes(limit=fetch_limit, offset=offset, user_ref=user_ref)
    notes: list[dict[str, object]] = []
    for r in rows:
        md = _normalize_metadata_dict(r)
        notebook = str(md.get("notebook") or "")
        is_ip_material = note_is_author_ip_material(md, notebook)
        if tab_norm == "reference" and is_ip_material:
            continue
        it = str(r.get("input_type") or "")
        src_url = str(r.get("source_url") or md.get("sourceUrl") or "")
        ext = _display_ext_for_note(input_type=it, metadata=md, source_url=src_url)
        note_uuid = str(r.get("id"))
        file_key = r.get("file_object_key")
        ct = str(r.get("content_text") or "").strip()
        rag_err = str(r.get("note_rag_index_error") or "").strip()
        rag_chunks = int(r.get("rag_chunk_count") or 0)
        p_st = str(md.get("parseStatus") or "").strip()
        p_eng = str(md.get("parseEngine") or "").strip()
        p_de = str(md.get("parseDetail") or "").strip()
        explicit_parse_error_code = str(md.get("parseErrorCode") or "").strip()
        mps = str(md.get("parseState") or "").strip()
        cap = _derive_source_capabilities(
            input_type=it,
            content_text=ct,
            parse_status=p_st,
            parse_detail=p_de,
            parse_engine=p_eng,
            rag_chunks=rag_chunks,
            rag_err=rag_err,
            created_at=str(r.get("created_at") or ""),
            rag_index_at=str(r.get("note_rag_index_at") or ""),
            metadata_parse_state=mps,
            has_file_object=bool(file_key),
        )
        author_ip_id = str(md.get("authorIpId") or "").strip()
        notes.append(
            {
                "noteId": note_uuid,
                "title": str(md.get("title") or "未命名笔记"),
                "notebook": notebook,
                "authorIpId": author_ip_id or None,
                "authorIpName": ip_names.get(author_ip_id) if author_ip_id else None,
                "isAuthorIpMaterial": is_ip_material,
                "ext": ext or "txt",
                "relativePath": f"/api/notes/{note_uuid}/file" if file_key else "",
                "createdAt": str(r.get("created_at") or ""),
                "deletedAt": str(r.get("deleted_at") or ""),
                "sourceUrl": src_url,
                "inputType": it,
                "sourceReady": bool(cap["sourceReady"]),
                "sourceHint": str(cap["sourceHint"] or ""),
                "parseState": str(cap["parseState"] or ""),
                "parseErrorCode": explicit_parse_error_code or str(cap["parseErrorCode"] or ""),
                "citeState": str(cap["citeState"] or ""),
                "retrieveState": str(cap["retrieveState"] or ""),
                "preprocessStatus": str(md.get("preprocessStatus") or ""),
            }
        )
    if tab_norm == "reference" and len(notes) > limit:
        notes = notes[:limit]
    has_more = len(rows) >= fetch_limit or len(notes) >= limit
    return {"success": True, "notes": notes, "has_more": has_more, "tab": tab_norm or None}


def _parse_trash_note_ids_body(body: dict[str, Any] | None) -> list[str]:
    raw = (body or {}).get("note_ids") or (body or {}).get("noteIds") or []
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="note_ids_required")
    ids = [str(x).strip() for x in raw if str(x).strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="note_ids_required")
    if len(ids) > 200:
        raise HTTPException(status_code=400, detail="too_many_notes")
    return ids


@router.post("/notes/trash/purge")
def purge_trash_notes_batch_api(request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    user_ref = _current_user_ref_or_401(request)
    note_ids = _parse_trash_note_ids_body(body)
    out = purge_notes_hard_batch(note_ids, user_ref=user_ref)
    if out.get("purgedIds"):
        invalidate_retrieval_cache_for_notes(list(out["purgedIds"]))
    return {"success": True, **out}


@router.post("/notes/trash/restore")
def restore_trash_notes_batch_api(request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    user_ref = _current_user_ref_or_401(request)
    note_ids = _parse_trash_note_ids_body(body)
    restored_ids: list[str] = []
    failed_ids: list[str] = []
    blocked_ip = 0
    for nid in note_ids:
        row = get_note_by_id(nid, include_deleted=True, user_ref=user_ref)
        if row:
            md = _normalize_metadata_dict(row)
            aid = str(md.get("authorIpId") or "").strip()
            if aid:
                try:
                    from ..author_ip_store import author_ip_is_active

                    if not author_ip_is_active(user_ref, aid):
                        failed_ids.append(nid)
                        blocked_ip += 1
                        continue
                except Exception:
                    pass
        if restore_note(nid, user_ref=user_ref):
            restored_ids.append(nid)
        else:
            failed_ids.append(nid)
    if restored_ids:
        invalidate_retrieval_cache_for_notes(restored_ids)
    return {
        "success": True,
        "total": len(note_ids),
        "restored": len(restored_ids),
        "restoredIds": restored_ids,
        "failed": len(failed_ids),
        "failedIds": failed_ids,
        "authorIpRestoreBlocked": blocked_ip,
    }


@router.post("/notes")
def create_note_api(req: NoteCreateRequest, request: Request):
    user_ref = _current_user_ref_or_401(request)
    nb = req.notebook.strip()
    if not nb:
        raise HTTPException(status_code=400, detail="notebook_required")
    project_id = ensure_default_project(req.project_name, created_by=user_ref)
    try:
        extra_meta = _build_preprocess_fields(req.content)
        extra_meta["structuredBlocks"] = _build_structured_blocks_from_text(req.content)
        note_id = create_text_note(
            project_id=project_id,
            title=req.title.strip() or "未命名笔记",
            notebook=nb,
            content=req.content,
            source_url=(req.source_url or "").strip() or None,
            user_ref=user_ref,
            extra_metadata=extra_meta,
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
            chat_history=body.chat_history,
            session_state=body.session_state,
            include_all_sources=body.include_all_sources,
            require_preprocess_ready=body.require_preprocess_ready,
            project_owner_user_uuid=project_owner,
            dialogue_style_prompt=body.dialogue_style_prompt,
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
            "preprocess_not_ready",
            "parse_gate_blocked",
        ):
            raise HTTPException(status_code=400, detail=msg) from e
        raise HTTPException(status_code=400, detail=msg) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"success": True, **out}


@router.post("/notes/ask/stream")
def notes_ask_stream_api(body: NotesAskRequest, request: Request):
    """基于已选笔记的问答：SSE，`data:` JSON 行，事件 type 为 chunk | done | followups | error。

    chunk 可选字段 ``streamRole``：``reasoning``（推理过程，仅流式展示）| ``answer``（正式回答，默认缺省视为 answer）。
    followups：``followUpQuestions`` 为 0～1 条答后关联问句（点击填入输入框，不自动发送）。
    上下文构建（向量检索等）在首个 SSE 字节之后进行，避免客户端长时间卡在「未收到响应头」；
    校验类错误改为流内 error 事件（仍先返回 200 + event-stream）。"""
    user_ref = _current_user_ref_or_401(request)
    owner_sid = (body.shared_from_owner_user_id or "").strip() or None
    project_owner: str | None = None
    if owner_sid:
        if not get_shared_notebook_public_access(owner_sid, body.notebook.strip()):
            raise HTTPException(status_code=404, detail="notebook_not_shared")
        project_owner = owner_sid

    rid = (request.headers.get("x-request-id") or "").strip() or str(uuid.uuid4())
    req_t0 = time.perf_counter()
    _notes_startup_logger.info(
        "notes_ask_stage stage=request_received request_id=%s notebook=%s note_count=%s question_len=%s",
        rid,
        body.notebook.strip(),
        len(body.note_ids or []),
        len((body.question or "").strip()),
    )

    def gen():
        # SSE 注释行：尽快向客户端/代理刷出首包，避免把整段 RAG 耗时算进「等响应头」
        yield ": stream-open\n\n"
        _notes_startup_logger.info(
            "notes_ask_stage stage=sse_opened request_id=%s elapsed_ms=%.1f",
            rid,
            (time.perf_counter() - req_t0) * 1000.0,
        )
        try:
            prep_t0 = time.perf_counter()
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "phase",
                        "phase": "retrieving",
                        "message": "正在检索并整理勾选资料…",
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )
            prepared = _prepare_notes_ask_messages(
                notebook=body.notebook.strip(),
                note_ids=body.note_ids,
                question=body.question.strip(),
                user_ref=user_ref,
                chat_history=body.chat_history,
                session_state=body.session_state,
                require_preprocess_ready=body.require_preprocess_ready,
                project_owner_user_uuid=project_owner,
                dialogue_style_prompt=body.dialogue_style_prompt,
            )
            _notes_startup_logger.info(
                "notes_ask_stage stage=context_ready request_id=%s elapsed_ms=%.1f context_ms=%.1f",
                rid,
                (time.perf_counter() - req_t0) * 1000.0,
                (time.perf_counter() - prep_t0) * 1000.0,
            )
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "phase",
                        "phase": "answering",
                        "message": "资料已就绪，正在生成回答…",
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )
        except ValueError as e:
            msg = str(e)
            _notes_startup_logger.warning(
                "notes_ask_stage stage=validation_error request_id=%s elapsed_ms=%.1f code=%s",
                rid,
                (time.perf_counter() - req_t0) * 1000.0,
                msg,
            )
            ev = notes_ask_value_error_sse_event(msg)
            if rid:
                ev["requestId"] = rid
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            return
        saw_first_chunk = False
        for ev in iter_notes_answer_events(
            notebook=body.notebook.strip(),
            note_ids=body.note_ids,
            question=body.question.strip(),
            user_ref=user_ref,
            chat_history=body.chat_history,
            session_state=body.session_state,
            include_all_sources=body.include_all_sources,
            require_preprocess_ready=body.require_preprocess_ready,
            prepared_messages_sources=prepared,
            project_owner_user_uuid=project_owner,
            request_id=rid,
            dialogue_style_prompt=body.dialogue_style_prompt,
        ):
            ev_type = str(ev.get("type") or "").strip()
            if ev_type == "chunk" and not saw_first_chunk:
                saw_first_chunk = True
                _notes_startup_logger.info(
                    "notes_ask_stage stage=first_chunk_out request_id=%s elapsed_ms=%.1f",
                    rid,
                    (time.perf_counter() - req_t0) * 1000.0,
                )
            elif ev_type == "done":
                _notes_startup_logger.info(
                    "notes_ask_stage stage=stream_done request_id=%s elapsed_ms=%.1f",
                    rid,
                    (time.perf_counter() - req_t0) * 1000.0,
                )
            elif ev_type == "error":
                _notes_startup_logger.warning(
                    "notes_ask_stage stage=stream_error_event request_id=%s elapsed_ms=%.1f code=%s",
                    rid,
                    (time.perf_counter() - req_t0) * 1000.0,
                    str(ev.get("code") or "").strip() or "unknown",
                )
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Request-ID": rid,
        },
    )


@router.patch("/notes/{note_id}")
@router.post("/notes/{note_id}/patch")
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
    md = _normalize_metadata_dict(row)
    title = str(md.get("title") or note_id).strip()
    ext = str(md.get("ext") or "").strip().lower()
    text = str(row.get("content_text") or "")
    truncated = False
    if len(text) > NOTE_PREVIEW_TEXT_MAX:
        text = text[:NOTE_PREVIEW_TEXT_MAX]
        truncated = True
    rag_n = count_rag_chunks_for_notes([str(note_id)])
    p_st = str(md.get("parseStatus") or "").strip()
    p_eng = str(md.get("parseEngine") or "").strip()
    p_de = str(md.get("parseDetail") or "").strip()
    file_key = row.get("file_object_key")
    mps = str(md.get("parseState") or "").strip()
    cap = _derive_source_capabilities(
        input_type=str(row.get("input_type") or ""),
        content_text=str(row.get("content_text") or ""),
        parse_status=p_st,
        parse_detail=p_de,
        parse_engine=p_eng,
        rag_chunks=rag_n,
        rag_err=str(row.get("note_rag_index_error") or "").strip(),
        created_at=str(row.get("created_at") or ""),
        rag_index_at=str(row.get("note_rag_index_at") or ""),
        metadata_parse_state=mps,
        has_file_object=bool(file_key),
    )
    preprocess_stage, next_action = _derive_preprocess_stage(md, cap)
    content_text = str(row.get("content_text") or "")
    word_count = _estimate_word_count(text)
    structured_blocks = _coerce_structured_blocks(md.get("structuredBlocks"))
    if not structured_blocks:
        structured_blocks = _build_structured_blocks_from_text(content_text)
    source_type = "网页" if str(row.get("source_url") or "").strip() else (
        "文件" if str(row.get("input_type") or "") == "note_file" else "文本"
    )
    rag_chunks_total = int(md.get("ragChunksTotal") or 0)
    rag_chunks_indexed = int(md.get("ragChunksIndexed") or rag_n)
    rag_index_truncated = bool(md.get("ragIndexTruncated"))
    if not rag_chunks_total and rag_n > 0:
        rag_chunks_total = rag_n
        rag_chunks_indexed = rag_n
    rag_index_coverage_pct = int(md.get("ragIndexCoveragePct") or (100 if not rag_index_truncated else 0))
    if rag_index_coverage_pct <= 0 and rag_n > 0 and not rag_index_truncated:
        rag_index_coverage_pct = 100
    coverage = note_coverage_stats(note_id, row)
    return {
        "success": True,
        "noteId": note_id,
        "title": title,
        "text": text,
        "truncated": truncated,
        "ext": ext,
        "ragChunkCount": rag_n,
        "ragChunksTotal": rag_chunks_total,
        "ragChunksIndexed": rag_chunks_indexed,
        "ragIndexTruncated": rag_index_truncated,
        "ragIndexStrategy": str(md.get("ragIndexStrategy") or "").strip(),
        "ragIndexCoveragePct": rag_index_coverage_pct,
        "totalChars": coverage.get("totalChars"),
        "shardsTotal": coverage.get("shardsTotal"),
        "shardsReady": coverage.get("shardsReady"),
        "shardsWithSummary": coverage.get("shardsWithSummary"),
        "shardSummaryCoveragePct": coverage.get("shardSummaryCoveragePct"),
        "shardStructureSource": coverage.get("shardStructureSource"),
        "chaptersTotal": coverage.get("chaptersTotal"),
        "chaptersWithSummary": coverage.get("chaptersWithSummary"),
        "chapterSummaryCoveragePct": coverage.get("chapterSummaryCoveragePct"),
        "chaptersDeepReady": coverage.get("chaptersDeepReady"),
        "bookSummaryL0Chars": coverage.get("bookSummaryL0Chars"),
        "chapterStructureSource": coverage.get("structureSource"),
        "summarySourceChars": int(md.get("summarySourceChars") or 0),
        "ragIndexError": str(row.get("note_rag_index_error") or "").strip(),
        "ragIndexedAt": str(row.get("note_rag_index_at") or ""),
        "parseStatus": p_st,
        "parseEngine": p_eng,
        "parseDetail": p_de,
        "parseEncoding": str(md.get("parseEncoding") or "").strip(),
        "parseOk": bool(cap["parseOk"]),
        "parseState": str(cap["parseState"] or ""),
        "parseErrorCode": str(cap["parseErrorCode"] or ""),
        "citeState": str(cap["citeState"] or ""),
        "retrieveState": str(cap["retrieveState"] or ""),
        "preprocessStatus": str(md.get("preprocessStatus") or ""),
        "preprocessSummary": str(md.get("preprocessSummary") or ""),
        "preprocessTags": md.get("preprocessTags") if isinstance(md.get("preprocessTags"), list) else [],
        "preprocessEntities": md.get("preprocessEntities") if isinstance(md.get("preprocessEntities"), list) else [],
        "preprocessStage": preprocess_stage,
        "nextAction": next_action,
        "sourceType": source_type,
        "sourceUrl": str(row.get("source_url") or md.get("sourceUrl") or ""),
        "createdAt": str(row.get("created_at") or ""),
        "wordCount": word_count,
        "structuredBlocks": structured_blocks,
        "parseGate": str(md.get("parseGate") or ""),
        "parseQuality": md.get("parseQuality") if isinstance(md.get("parseQuality"), dict) else {},
        "pageBreaks": page_breaks_from_segments(
            md.get("ragChunkSegments") if isinstance(md.get("ragChunkSegments"), list) else []
        ),
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
async def upload_note_json_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    rid = (request.headers.get("x-request-id") or "").strip()
    try:
        raw_body = await request.body()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体读取失败")
    try:
        body_obj = json.loads(raw_body or b"{}")
    except Exception:
        # 兼容异常字节：先容错解码再尝试 JSON 解析，避免 UnicodeDecodeError 泄漏到全局。
        try:
            body_obj = json.loads(safe_decode_bytes(raw_body))
        except Exception:
            raise HTTPException(status_code=400, detail="invalid_json_body") from None
    if not isinstance(body_obj, dict):
        raise HTTPException(status_code=400, detail="invalid_json_body")
    _upload_diag(
        "upload_json_body_parsed",
        request_id=rid or "-",
        content_type=request.headers.get("content-type") or "",
        raw_body_len=len(raw_body),
        body_keys=list(body_obj.keys())[:20],
    )
    data_base64 = str(body_obj.get("data_base64") or "").strip()
    filename = str(body_obj.get("filename") or "").strip()
    title = str(body_obj.get("title") or "").strip()
    notebook = str(body_obj.get("notebook") or "").strip()
    project_name = str(body_obj.get("project_name") or NOTES_PODCAST_STUDIO_PROJECT).strip() or NOTES_PODCAST_STUDIO_PROJECT
    if not data_base64:
        raise HTTPException(status_code=400, detail="文件数据无效")
    try:
        data = base64.b64decode(data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="文件数据无效")
    raw_name = filename
    try:
        return _persist_note_upload(user_ref, data, raw_name, title, notebook, project_name)
    except HTTPException:
        raise
    except Exception as exc:
        rid = (request.headers.get("x-request-id") or "").strip()
        _notes_startup_logger.exception("notes upload_json unexpected error request_id=%s", rid or "-")
        hint = f"（request_id={rid}）" if rid else ""
        raise HTTPException(
            status_code=500,
            detail=f"上传处理失败：{exc.__class__.__name__}{hint}",
        ) from exc


@router.post("/notes/upload_raw")
async def upload_note_raw_api(
    request: Request,
):
    """BFF 二进制转发：body 为原始文件字节，元数据在 query（避免对整段 multipart 做内部签名）。"""
    user_ref = _current_user_ref_or_401(request)
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")
    notebook = _query_param_lossy_utf8(request, "notebook", "")
    filename = _query_param_lossy_utf8(request, "filename", "")
    title = _query_param_lossy_utf8(request, "title", "")
    project_name = _query_param_lossy_utf8(request, "project_name", NOTES_PODCAST_STUDIO_PROJECT)
    _upload_diag(
        "upload_raw_request_parsed",
        request_id=(request.headers.get("x-request-id") or "").strip() or "-",
        content_type=request.headers.get("content-type") or "",
        body_len=len(data),
        notebook=notebook,
        filename=filename,
        project_name=project_name,
        query_len=len(bytes(request.scope.get("query_string", b""))) if isinstance(request.scope.get("query_string", b""), (bytes, bytearray)) else -1,
    )
    if not (notebook or "").strip():
        raise HTTPException(status_code=400, detail="notebook_required")
    if not (filename or "").strip():
        raise HTTPException(status_code=400, detail="无效文件名")
    fname = (filename or "").strip()
    pn = (project_name or NOTES_PODCAST_STUDIO_PROJECT).strip() or NOTES_PODCAST_STUDIO_PROJECT
    try:
        return _persist_note_upload(
            user_ref,
            data,
            fname,
            (title or "").strip(),
            (notebook or "").strip(),
            pn,
        )
    except HTTPException:
        raise
    except Exception as exc:
        rid = (request.headers.get("x-request-id") or "").strip()
        _notes_startup_logger.exception("notes upload_raw unexpected error request_id=%s", rid or "-")
        hint = f"（request_id={rid}）" if rid else ""
        raise HTTPException(
            status_code=500,
            detail=f"上传处理失败：{exc.__class__.__name__}{hint}",
        ) from exc


@router.post("/notes/import_url")
async def import_note_from_url_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    try:
        raw_body = await request.body()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体读取失败")
    try:
        body_obj = json.loads(raw_body or b"{}")
    except Exception:
        try:
            body_obj = json.loads(safe_decode_bytes(raw_body))
        except Exception:
            raise HTTPException(status_code=400, detail="invalid_json_body") from None
    if not isinstance(body_obj, dict):
        raise HTTPException(status_code=400, detail="invalid_json_body")
    _upload_diag(
        "import_url_body_parsed",
        request_id=(request.headers.get("x-request-id") or "").strip() or "-",
        content_type=request.headers.get("content-type") or "",
        raw_body_len=len(raw_body),
        body_keys=list(body_obj.keys())[:20],
    )
    url = str(body_obj.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="请提供 URL")
    try:
        fetch = content_parser.parse_url(url)
        content = str(fetch.get("content") or "").replace("\x00", "").strip()
        fetch_logs = fetch.get("logs") if isinstance(fetch.get("logs"), list) else []
        if not fetch.get("success") or not content:
            err_code = str(fetch.get("error_code") or "").strip() or "URL_PARSE_FAILED"
            hint = str(fetch.get("hint") or "").strip() or actionable_hint_for_failed_url(
                url,
                error_code=str(fetch.get("error_code") or "").strip() or None,
                upstream_error=str(fetch.get("error") or "").strip() or None,
            )
            head = str(fetch.get("error") or "").strip() or "未能从网页提取正文"
            raise HTTPException(
                status_code=400,
                detail=format_import_url_http_detail(err_code=err_code, head=head, base_hint=hint, url=url),
            )
        host = (urlparse(url).netloc or "").strip().lower()
        if host.startswith("www."):
            host = host[4:]
        if host.endswith("xiaohongshu.com"):
            parse_meta = fetch.get("parse_meta") if isinstance(fetch.get("parse_meta"), dict) else {}
            used_script_extract = bool(parse_meta.get("xhs_script_extract_hit"))
            if not used_script_extract:
                hint = str(fetch.get("hint") or "").strip() or actionable_hint_for_failed_url(
                    url,
                    error_code="login_wall",
                    upstream_error="xiaohongshu_script_extract_missing",
                )
                raise HTTPException(
                    status_code=400,
                    detail=format_import_url_http_detail(
                        err_code="URL_LOGIN_WALL",
                        head="小红书链接未命中正文抽取通道（仅获取到壳层页面）",
                        base_hint=hint,
                        url=url,
                    ),
                )
        if host.endswith("xiaohongshu.com") and _looks_like_xiaohongshu_shell_text(content):
            hint = str(fetch.get("hint") or "").strip() or actionable_hint_for_failed_url(
                url,
                error_code="login_wall",
                upstream_error="xiaohongshu_shell_text_only",
            )
            raise HTTPException(
                status_code=400,
                detail=format_import_url_http_detail(
                    err_code="URL_LOGIN_WALL",
                    head="小红书仅返回页面壳层文本，未解析到正文",
                    base_hint=hint,
                    url=url,
                ),
            )
        parse_meta = fetch.get("parse_meta") if isinstance(fetch.get("parse_meta"), dict) else {}
        low_quality_reject, low_quality_code = _url_parse_should_reject_low_quality(parse_meta, content)
        if low_quality_reject:
            hint = str(fetch.get("hint") or "").strip() or actionable_hint_for_failed_url(
                url,
                error_code="quality_low",
                upstream_error=low_quality_code,
            )
            reason_codes = parse_meta.get("reason_codes") if isinstance(parse_meta.get("reason_codes"), list) else []
            reason_text = ",".join([str(x).strip() for x in reason_codes if str(x).strip()][:6]) or low_quality_code
            raise HTTPException(
                status_code=400,
                detail=format_import_url_http_detail(
                    err_code="URL_PARSE_LOW_QUALITY",
                    head=f"网页正文质量不足，已阻止入库（{reason_text}）",
                    base_hint=hint,
                    url=url,
                ),
            )
        notebook = str(body_obj.get("notebook") or "").strip()
        if not notebook:
            raise HTTPException(status_code=400, detail="notebook_required")
        custom_title = str(body_obj.get("title") or "").strip()
        fetched_title = str(fetch.get("title") or "").strip()
        if custom_title:
            title = custom_title
        elif fetched_title:
            title = fetched_title
        else:
            pu = urlparse(url)
            host = (pu.netloc or "").strip()
            title = f"{host} 摘录" if host else "网页笔记"
        title = _safe_user_text(title, max_len=240) or "网页笔记"
        project_name = str(body_obj.get("project_name") or NOTES_PODCAST_STUDIO_PROJECT).strip() or NOTES_PODCAST_STUDIO_PROJECT
        project_id = ensure_default_project(project_name, created_by=user_ref)
        content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        canonical_url = str(fetch.get("url") or url).strip() or url
        old_rows = list_notes(
            notebook=notebook,
            limit=500,
            offset=0,
            user_ref=user_ref,
        )
        same_url_version = 0
        for old in old_rows:
            old_source = str(old.get("source_url") or "").strip()
            if old_source != canonical_url:
                continue
            old_md = _normalize_metadata_dict(old)
            try:
                old_v = int(old_md.get("sourceVersion") or 1)
            except (TypeError, ValueError):
                old_v = 1
            same_url_version = max(same_url_version, old_v)
            old_hash = str(old_md.get("sourceContentSha256") or "").strip()
            if old_hash and old_hash == content_sha256:
                return {
                    "success": True,
                    "deduped": True,
                    "noteId": str(old.get("id") or ""),
                    "title": str(old_md.get("title") or ""),
                    "notebook": notebook,
                    "sourceVersion": old_v,
                    "sourceCanonicalUrl": canonical_url,
                }
        new_version = same_url_version + 1
        try:
            note_id = create_text_note(
                project_id=project_id,
                title=title,
                notebook=notebook,
                content=content,
                source_url=canonical_url,
                user_ref=user_ref,
                extra_metadata={
                    "parseStatus": "ok",
                    "parseEngine": "url-content-parser",
                    "sourceCanonicalUrl": canonical_url,
                    "sourceContentSha256": content_sha256,
                    "sourceVersion": new_version,
                    "structuredBlocks": _coerce_structured_blocks(fetch.get("structured_blocks")),
                    "sourceParseMeta": fetch.get("parse_meta")
                    if isinstance(fetch.get("parse_meta"), dict)
                    else {},
                    **_build_preprocess_fields(content),
                },
            )
        except ValueError as e:
            if str(e) == "notebook_required":
                raise HTTPException(status_code=400, detail="notebook_required") from e
            raise
        _try_enqueue_note_rag_index(note_id, user_ref)
        return {
            "success": True,
            "noteId": note_id,
            "title": title,
            "notebook": notebook,
            "sourceVersion": new_version,
            "sourceCanonicalUrl": canonical_url,
        }
    except HTTPException:
        raise
    except Exception as exc:
        rid = (request.headers.get("x-request-id") or "").strip() or "-"
        _notes_startup_logger.exception("notes import_url unexpected error request_id=%s", rid)
        raise HTTPException(
            status_code=500,
            detail=f"url_import_runtime_error:{exc.__class__.__name__}:{str(exc)[:220]}（request_id={rid}）",
        ) from exc


@router.delete("/notes/{note_id}")
@router.post("/notes/{note_id}/delete")
def delete_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    ok = delete_note(note_id, user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    invalidate_retrieval_cache_for_notes([note_id])
    return {"success": True, "noteId": note_id, "moved_to_trash": True}


@router.post("/notes/{note_id}/restore")
def restore_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, include_deleted=True, user_ref=user_ref)
    if row:
        md = _normalize_metadata_dict(row)
        aid = str(md.get("authorIpId") or "").strip()
        if aid:
            try:
                from ..author_ip_store import author_ip_is_active

                if not author_ip_is_active(user_ref, aid):
                    raise HTTPException(
                        status_code=400,
                        detail="author_ip_missing_restore_blocked",
                    )
            except HTTPException:
                raise
            except Exception:
                pass
    ok = restore_note(note_id, user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    invalidate_retrieval_cache_for_notes([note_id])
    return {"success": True, "noteId": note_id}


@router.delete("/notes/{note_id}/purge")
@router.post("/notes/{note_id}/purge")
def purge_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    ok = purge_note_hard(note_id, user_ref=user_ref)
    if not ok:
        raise HTTPException(status_code=404, detail="note_not_found")
    invalidate_retrieval_cache_for_notes([note_id])
    return {"success": True, "noteId": note_id}


@router.post("/notes/{note_id}/reindex")
def reindex_note_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    content_text = str(row.get("content_text") or "").strip()
    if not content_text:
        raise HTTPException(status_code=400, detail="note_content_empty")
    clear_note_rag_index_error(note_id)
    invalidate_retrieval_cache_for_notes([note_id])
    _try_enqueue_note_rag_index(note_id, user_ref)
    return {"success": True, "noteId": note_id, "status": "reindex_queued"}


@router.get("/notes/{note_id}/index_progress")
def note_index_progress_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    from ..note_shards import shard_index_progress

    prog = shard_index_progress(note_id)
    cov = note_coverage_stats(note_id, row)
    return {"success": True, "noteId": note_id, **prog, **cov}


@router.post("/notes/{note_id}/studio/{task}")
def note_studio_api(note_id: str, task: str, request: Request, body: dict[str, Any] | None = None):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    from ..note_studio import run_note_studio

    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None
    body_obj = body if isinstance(body, dict) else {}
    shard_ids = body_obj.get("shardIds") or body_obj.get("shard_ids")
    if isinstance(shard_ids, list):
        shard_ids = [str(x) for x in shard_ids if str(x).strip()]
    else:
        shard_ids = None
    out = run_note_studio(
        note_id, task, user_ref=user_ref, api_key=api_key, shard_ids=shard_ids
    )
    if not out.get("ok"):
        code = 400 if out.get("error") in ("no_summaries", "invalid_task") else 500
        raise HTTPException(status_code=code, detail=str(out.get("error") or "studio_failed"))
    return {"success": True, "noteId": note_id, **out}


@router.get("/notes/{note_id}/studio/artifacts")
def note_studio_artifacts_api(note_id: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        raise HTTPException(status_code=404, detail="note_not_found")
    from ..note_studio import list_studio_artifacts

    arts = list_studio_artifacts(note_id, user_ref=user_ref)
    return {"success": True, "noteId": note_id, "artifacts": arts}


@router.post("/notebooks/{notebook}/studio/{task}")
def notebook_studio_api(notebook: str, task: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    user_ref = _current_user_ref_or_401(request)
    from ..note_studio import run_notebook_studio

    note_ids = body.get("note_ids") or body.get("noteIds") or []
    if not isinstance(note_ids, list) or not note_ids:
        raise HTTPException(status_code=400, detail="note_ids_required")
    api_key = str(os.getenv("MINIMAX_API_KEY") or "").strip() or None
    out = run_notebook_studio(
        notebook, [str(x) for x in note_ids], task, user_ref=user_ref, api_key=api_key
    )
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=str(out.get("error") or "studio_failed"))
    return {"success": True, **out}


@router.get("/notebooks/{notebook}/digest")
def notebook_digest_get_api(notebook: str, request: Request):
    user_ref = _current_user_ref_or_401(request)
    from ..note_notebook_digest import get_notebook_digest

    digest = get_notebook_digest(notebook, user_ref=user_ref)
    return {"success": True, "notebook": notebook, "digest": digest}


@router.post("/notebooks/{notebook}/audio_overview")
def notebook_audio_overview_api(notebook: str, request: Request, body: dict[str, Any] = Body(default_factory=dict)):
    user_ref = _current_user_ref_or_401(request)
    from ..note_audio_overview import build_audio_overview_context, target_minutes_default

    note_ids = body.get("note_ids") or body.get("noteIds") or []
    if not isinstance(note_ids, list) or not note_ids:
        raise HTTPException(status_code=400, detail="note_ids_required")
    nids = [str(x).strip() for x in note_ids if str(x).strip()]
    focus = str(body.get("focus") or "").strip()
    mins = body.get("target_minutes") or body.get("targetMinutes") or target_minutes_default()
    try:
        mins = int(mins)
    except (TypeError, ValueError):
        mins = target_minutes_default()
    ctx, meta = build_audio_overview_context(nids, user_ref=user_ref, focus=focus)
    if not ctx:
        raise HTTPException(status_code=400, detail=str(meta.get("error") or "no_summaries"))
    pid = ensure_default_project(NOTES_PODCAST_STUDIO_PROJECT, created_by=user_ref)
    payload: dict[str, Any] = {
        "text": focus or f"请根据以下资料摘要，生成约 {mins} 分钟的播客式音频概览（双人对话，脉络清晰）。",
        "reference_mode": "audio_overview",
        "audio_overview_context": ctx,
        "notes_notebook": notebook.strip(),
        "selected_note_ids": nids,
        "script_target_chars": mins * 650,
        "script_style": "轻松幽默，自然流畅",
        "speaker1_persona": "活泼亲切，引导话题",
        "speaker2_persona": "稳重专业，深度分析",
        "script_language": str(body.get("language") or "中文"),
        "program_name": str(body.get("program_name") or "资料音频概览"),
        "use_rag": False,
        "notes_reference_full_text": True,
    }
    job_id = create_job(pid, "script_draft", "ai", payload, created_by=user_ref)
    ai_queue.enqueue(run_ai_job, job_id, job_timeout=3600)
    return {"success": True, "jobId": job_id, "notebook": notebook, "meta": meta}


@router.get("/notebooks/stats")
def notebook_stats_api(request: Request):
    """按笔记本聚合资料条数与最早创建时间（供知识库 hub 元数据，避免分页扫 notes）。"""
    user_ref = _current_user_ref_or_401(request)
    stats = aggregate_notebook_input_stats(user_ref)
    return {"success": True, "statsByNotebook": stats}


@router.get("/notebooks")
def list_notebooks_api(request: Request):
    user_ref = _current_user_ref_or_401(request)
    migrate_legacy_default_notebook_for_user(user_ref)
    ensure_default_library_notebook(user_ref)
    notebook_kinds: dict[str, dict[str, Any]] = {}
    try:
        from ..author_ip_store import (
            ensure_author_ip_notebook,
            list_user_notebook_kinds_meta,
            order_notebook_names_for_list,
        )

        ensure_author_ip_notebook(user_ref)
        notebook_kinds = list_user_notebook_kinds_meta(user_ref)
    except Exception:
        _notes_startup_logger.exception("list_notebooks: ensure author ip failed")
    names = list_notebook_names(user_ref=user_ref)
    try:
        from ..author_ip_store import exclude_author_ip_notebooks

        names = exclude_author_ip_notebooks(names, user_ref)
    except Exception:
        _notes_startup_logger.exception("list_notebooks: exclude author ip notebooks failed")
    if notebook_kinds:
        ordered = order_notebook_names_for_list(names, notebook_kinds)
    else:
        ordered = sorted(set(names), key=lambda x: x)
    sharing = list_user_notebook_sharing_meta(user_ref)
    covers = list_notebook_covers_meta(user_ref)
    return {
        "success": True,
        "notebooks": ordered,
        "notebookSharing": sharing,
        "notebookCovers": covers,
        "notebookKinds": notebook_kinds,
    }


@router.get("/notebooks/popular")
def list_popular_notebooks_api(
    request: Request,
    limit: int = Query(default=40, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=10_000),
):
    """公开发现列表：未登录也可浏览。"""
    _ = request
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
@router.post("/notebooks/{notebook_name:path}/share")
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


@router.delete("/notebooks/{notebook_name:path}")
@router.post("/notebooks/{notebook_name:path}/delete")
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


@router.patch("/notebooks/{notebook_name:path}")
@router.post("/notebooks/{notebook_name:path}")
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


def ensure_notebooks_schema_startup(*, strict: bool = False) -> None:
    try:
        ensure_notebooks_schema()
        ensure_note_rag_schema()
        purge_expired_trashed_notes(retention_days=NOTE_TRASH_RETENTION_DAYS, max_rows=settings.trash_purge_max_rows)
    except Exception:
        _notes_startup_logger.exception("notebooks schema startup failed")
        if strict:
            raise
