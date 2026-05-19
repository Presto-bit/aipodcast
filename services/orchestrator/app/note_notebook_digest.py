"""笔记本级跨资料摘要（L0.5）。"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from .db import get_conn, get_cursor
from .models import get_note_by_id, list_notes
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_DIGEST_SYS = (
    "你是研究助手。根据多篇资料的「全书概览」摘要，写一段 250～400 字的笔记本级综述，"
    "说明这些资料共同主题、各自侧重点与可对比维度。只使用给定内容，不要编造。"
)


def _metadata_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md) if md.strip() else {}
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def _max_notes() -> int:
    try:
        return max(2, min(16, int(os.getenv("NOTEBOOK_STUDIO_MAX_NOTES", "8") or "8")))
    except (TypeError, ValueError):
        return 8


def build_notebook_digest_context(
    notebook: str,
    note_ids: list[str],
    *,
    user_ref: str | None,
) -> tuple[str, list[dict[str, Any]]]:
    capped = note_ids[: _max_notes()]
    parts: list[str] = []
    fingerprints: list[dict[str, Any]] = []
    for nid in capped:
        row = get_note_by_id(nid, user_ref=user_ref)
        if not row:
            continue
        md = _metadata_dict(row)
        title = str(md.get("title") or nid).strip()
        l0 = str(md.get("bookSummaryL0") or row.get("note_summary") or "").strip()
        one = l0[:400] if l0 else str(row.get("content_text") or "")[:200]
        parts.append(f"### {title}\n\n{one or '（无摘要）'}")
        fingerprints.append({"noteId": nid, "title": title, "oneLiner": one[:120]})
    return "\n\n".join(parts)[:48_000], fingerprints


def refresh_notebook_digest(
    notebook: str,
    note_ids: list[str],
    *,
    user_ref: str | None,
    api_key: str | None = None,
) -> dict[str, Any]:
    ctx, fps = build_notebook_digest_context(notebook, note_ids, user_ref=user_ref)
    if not ctx.strip():
        return {"ok": False, "error": "no_summaries"}
    try:
        out, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": _DIGEST_SYS},
                {"role": "user", "content": ctx},
            ],
            temperature=0.35,
            api_key=api_key,
            timeout_sec=90,
            max_tokens=1024,
        )
        summary = (out or "").strip()
    except Exception as exc:
        logger.warning("notebook_digest failed: %s", exc)
        return {"ok": False, "error": str(exc)[:200]}

    digest = {
        "summary": summary,
        "noteFingerprints": fps,
        "notebook": notebook,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    save_notebook_digest(notebook, digest, user_ref=user_ref)
    return {"ok": True, "digest": digest}


def save_notebook_digest(notebook: str, digest: dict[str, Any], *, user_ref: str | None) -> None:
    from .models import _resolve_user_uuid_or_none  # noqa: PLC0415

    nb = (notebook or "").strip()
    if not nb:
        return
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _resolve_user_uuid_or_none(cur, user_ref)
                if not uid:
                    return
                cur.execute(
                    """
                    ALTER TABLE user_notebooks
                    ADD COLUMN IF NOT EXISTS digest_json JSONB NOT NULL DEFAULT '{}'::jsonb
                    """
                )
                cur.execute(
                    """
                    UPDATE user_notebooks
                    SET digest_json = %s::jsonb
                    WHERE user_id = %s::uuid AND name = %s
                    """,
                    (json.dumps(digest, ensure_ascii=False), uid, nb),
                )
                conn.commit()
    except Exception as exc:
        logger.warning("save_notebook_digest failed: %s", exc)


def get_notebook_digest(notebook: str, *, user_ref: str | None) -> dict[str, Any] | None:
    from .models import _resolve_user_uuid_or_none  # noqa: PLC0415

    nb = (notebook or "").strip()
    if not nb:
        return None
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                uid = _resolve_user_uuid_or_none(cur, user_ref)
                if not uid:
                    return None
                cur.execute(
                    """
                    SELECT digest_json FROM user_notebooks
                    WHERE user_id = %s::uuid AND name = %s
                    """,
                    (uid, nb),
                )
                row = cur.fetchone()
                if not row:
                    return None
                dj = row.get("digest_json") or {}
                if isinstance(dj, str):
                    dj = json.loads(dj) if dj.strip() else {}
                return dj if isinstance(dj, dict) and dj.get("summary") else None
    except Exception:
        return None


def list_notebook_note_ids(notebook: str, *, user_ref: str | None) -> list[str]:
    rows = list_notes(notebook=notebook, limit=200, user_ref=user_ref) or []
    out: list[str] = []
    for r in rows:
        nid = str(r.get("id") or r.get("note_id") or "").strip()
        if nid:
            out.append(nid)
    return out
