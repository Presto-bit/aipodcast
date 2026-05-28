"""笔记附件异步正文解析（方案 B：先存原文件，后台 extract_text）。"""
from __future__ import annotations

import logging
import time
from typing import Any

from .models import get_note_by_id
from .note_document_extract import NoteParseResult, extract_text_from_bytes
from .note_studio import _merge_note_metadata
from .note_parse_quality import merge_upload_parse_metadata
from .object_store import get_object_bytes

logger = logging.getLogger(__name__)


def _set_parse_state(note_id: str, state: str, extra: dict[str, Any] | None = None) -> None:
    patch: dict[str, Any] = {"parseState": state}
    if extra:
        patch.update(extra)
    _merge_note_metadata(note_id, patch)


def _update_note_content(note_id: str, content_text: str) -> None:
    from .models import get_conn, get_cursor

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE inputs SET content_text = %s WHERE id = %s::uuid",
                (content_text, note_id),
            )
            conn.commit()


def run_note_file_parse(note_id: str, user_ref: str | None = None) -> dict[str, Any]:
    """
    从对象存储读取原文件、解析正文并写回 inputs；成功后排队 RAG 索引。
    """
    nid = (note_id or "").strip()
    if not nid:
        return {"ok": False, "error": "note_id_required"}

    row = get_note_by_id(nid, user_ref=user_ref)
    if not row:
        return {"ok": False, "error": "note_not_found"}

    if str(row.get("input_type") or "") != "note_file":
        return {"ok": False, "error": "not_file_note"}

    key = str(row.get("file_object_key") or "").strip()
    if not key:
        return {"ok": False, "error": "file_missing"}

    md = row.get("metadata") or {}
    if isinstance(md, str):
        import json

        try:
            md = json.loads(md) if md.strip() else {}
        except Exception:
            md = {}
    if not isinstance(md, dict):
        md = {}

    ext = str(md.get("ext") or "txt").lower().lstrip(".")
    _set_parse_state(nid, "parsing", {"parseStatus": "parsing"})

    from .routes import notes_routes as nr

    parse_started = time.perf_counter()
    try:
        data = get_object_bytes(key)
        if not data:
            _set_parse_state(
                nid,
                "failed",
                {
                    "parseStatus": "empty",
                    "parseDetail": "对象存储中未找到原文件",
                    "parseErrorCode": "file_missing",
                },
            )
            return {"ok": False, "error": "file_missing"}

        parse_result = extract_text_from_bytes(data, ext)
        parsed = (parse_result.text or "").strip()
        parse_error_code = nr._parse_error_code_for_upload(ext, parse_result)

        parse_duration_ms = int((time.perf_counter() - parse_started) * 1000)
        extra_meta: dict[str, object] = {
            "parseStatus": parse_result.status,
            "parseEngine": parse_result.engine,
            "parseDurationMs": parse_duration_ms,
            "parseDetail": (parse_result.detail or "")[:500] if parse_result.detail else "",
            "parseEncoding": (parse_result.encoding or "")[:120] if parse_result.encoding else "",
            "parseErrorCode": parse_error_code or "",
            "parseTextChars": len(parsed),
        }
        if parse_result.detail:
            extra_meta["parseDetail"] = str(parse_result.detail)[:500]

        merge_upload_parse_metadata(
            extra_meta,
            parse_result,
            content_text=parsed,
            ext=ext,
            parse_error_code=parse_error_code or "",
        )
        if "structuredBlocks" not in extra_meta:
            extra_meta["structuredBlocks"] = nr._build_structured_blocks_from_text(parsed)
        extra_meta.update(nr._build_preprocess_fields(parsed))

        if parse_result.status == "ok" and parsed:
            extra_meta["parseState"] = "success"
        elif parse_result.status in ("error", "empty"):
            extra_meta["parseState"] = "failed"
        else:
            extra_meta["parseState"] = "partial" if parsed else "failed"

        _update_note_content(nid, parsed)
        _merge_note_metadata(nid, extra_meta)

        if parsed and parse_result.status == "ok":
            nr._try_enqueue_note_rag_index(nid, user_ref)

        return {
            "ok": True,
            "parseState": extra_meta.get("parseState"),
            "textChars": len(parsed),
            "parseStatus": parse_result.status,
        }
    except Exception as exc:
        logger.exception("note_file_parse failed note_id=%s", nid)
        _set_parse_state(
            nid,
            "failed",
            {
                "parseStatus": "error",
                "parseDetail": str(exc)[:400],
                "parseErrorCode": "parse_failed",
            },
        )
        return {"ok": False, "error": str(exc)[:400]}
