"""
资料 Studio：基于 L0 + 片摘要生成简报等（不重扫全文）。
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from .db import get_conn, get_cursor
from .models import get_note_by_id
from .note_notebook_digest import build_notebook_digest_context, _max_notes as notebook_studio_max_notes
from .note_shards import list_shards
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_TASK_PROMPTS: dict[str, str] = {
    "brief": (
        "你是编辑。根据摘要写一份 1 页以内的学习简报（Markdown）：核心论点、关键事实、待进一步阅读的问题。"
        "只使用摘要内容。"
    ),
}


def studio_max_artifacts() -> int:
    try:
        return max(5, min(50, int(os.getenv("NOTE_STUDIO_MAX_ARTIFACTS", "20") or "20")))
    except (TypeError, ValueError):
        return 20


def _metadata_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md) if md.strip() else {}
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def _merge_note_metadata(note_id: str, patch: dict[str, Any]) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE inputs
                SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                WHERE id = %s::uuid
                """,
                (json.dumps(patch, ensure_ascii=False), note_id),
            )
            conn.commit()


def _context_from_note(row: dict[str, Any], *, shard_ids: list[str] | None = None) -> str:
    md = _metadata_dict(row)
    l0 = str(md.get("bookSummaryL0") or row.get("note_summary") or "").strip()
    parts: list[str] = []
    if l0:
        parts.append(f"## 全书概览\n\n{l0}")
    nid = str(row.get("id") or "")
    shards = list_shards(nid) if nid else []
    want = set(shard_ids or [])
    for sh in shards:
        sid = str(sh.get("shard_id") or "")
        if want and sid not in want:
            continue
        title = str(sh.get("title") or sid)
        summary = str(sh.get("summary_text") or "").strip()
        if summary:
            parts.append(f"## {title}\n\n{summary}")
    return "\n\n---\n\n".join(parts)[:44_000]


def _append_artifact(note_id: str, artifact: dict[str, Any]) -> None:
    row = get_note_by_id(note_id)
    if not row:
        return
    md = _metadata_dict(row)
    arts = md.get("studioArtifacts")
    if not isinstance(arts, list):
        arts = []
    arts = [a for a in arts if isinstance(a, dict)]
    arts.insert(0, artifact)
    arts = arts[: studio_max_artifacts()]
    _merge_note_metadata(note_id, {"studioArtifacts": arts})


def list_studio_artifacts(note_id: str, *, user_ref: str | None) -> list[dict[str, Any]]:
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return []
    md = _metadata_dict(row)
    arts = md.get("studioArtifacts")
    return [a for a in arts if isinstance(a, dict)] if isinstance(arts, list) else []


def run_note_studio(
    note_id: str,
    task: str,
    *,
    user_ref: str | None,
    shard_ids: list[str] | None = None,
    api_key: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """task: brief"""
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return {"ok": False, "error": "note_not_found"}
    ctx = _context_from_note(row, shard_ids=shard_ids)
    if not ctx.strip():
        return {"ok": False, "error": "no_summaries", "hint": "请先完成资料索引与片摘要"}

    t = (task or "").strip().lower()
    system = _TASK_PROMPTS.get(t)
    if not system:
        return {"ok": False, "error": "invalid_task"}

    try:
        out, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": ctx},
            ],
            temperature=0.4,
            api_key=api_key,
            timeout_sec=120,
            max_tokens=4096,
        )
        text = (out or "").strip()
    except Exception as exc:
        logger.warning("note_studio %s failed: %s", t, exc)
        return {"ok": False, "error": str(exc)[:200]}

    result: dict[str, Any] = {"ok": True, "task": t, "markdown": text}

    if persist:
        aid = str(uuid.uuid4())
        artifact = {
            "id": aid,
            "task": t,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "markdown": text,
        }
        _append_artifact(note_id, artifact)
        result["artifactId"] = aid

    return result


def run_notebook_studio(
    notebook: str,
    note_ids: list[str],
    task: str,
    *,
    user_ref: str | None,
    api_key: str | None = None,
) -> dict[str, Any]:
    capped = note_ids[:notebook_studio_max_notes()]
    ctx, _fps = build_notebook_digest_context(notebook, capped, user_ref=user_ref)
    if not ctx.strip():
        return {"ok": False, "error": "no_summaries"}
    t = (task or "").strip().lower()
    if t != "brief":
        return {"ok": False, "error": "invalid_task", "hint": "笔记本级仅支持 brief"}
    system = _TASK_PROMPTS[t]
    try:
        out, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system + " 这是同一笔记本下多篇资料的摘要。"},
                {"role": "user", "content": ctx},
            ],
            temperature=0.4,
            api_key=api_key,
            timeout_sec=120,
            max_tokens=4096,
        )
        text = (out or "").strip()
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:200]}
    return {"ok": True, "task": t, "markdown": text, "notebook": notebook, "noteCount": len(capped)}
