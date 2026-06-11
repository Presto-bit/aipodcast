"""Studio reply 路径：轻量资料检索 excerpt + sources 元数据。"""
from __future__ import annotations

from typing import Any

from ..note_rag_service import get_note_by_id, retrieve_chunks_across_notes
from ..notes_ask_qa import _enrich_sources_with_chunks, _metadata_title
from .studio_constants import STUDIO_CORPUS_MAX_NOTE_IDS


def _ordered_note_ids(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for x in raw:
        nid = str(x or "").strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        out.append(nid)
    return out[:STUDIO_CORPUS_MAX_NOTE_IDS]


def _base_sources(
    note_ids: list[str],
    *,
    user_ref: str,
    owner: str | None,
) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for i, nid in enumerate(note_ids, start=1):
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=owner)
        title = _metadata_title(row, nid) if row else nid
        sources.append({"index": str(i), "noteId": nid, "title": title})
    return sources


def fetch_reply_corpus_with_sources(
    *,
    user_ref: str,
    payload: dict[str, Any],
    query: str,
    max_chars: int = 6_000,
    top_k: int = 8,
) -> tuple[str, list[dict[str, Any]]]:
    """reply + 勾选资料：检索 top 段落并返回 sources（含 chunks）。"""
    nids = _ordered_note_ids(payload.get("noteIds") or payload.get("selected_note_ids"))
    if not nids:
        return "", []
    notebook = str(payload.get("notebook") or payload.get("notes_notebook") or "").strip()
    owner = str(payload.get("notes_source_owner_user_id") or "").strip() or None
    hint = f"{query.strip()[:400]} {notebook}".strip()
    sources = _base_sources(nids, user_ref=user_ref, owner=owner)
    try:
        context, retr_meta, _ = retrieve_chunks_across_notes(
            note_ids=nids,
            query=hint[:500] or query.strip()[:500],
            max_chars=max_chars,
            top_k=top_k,
            notes_ask_fast_path=True,
            user_ref=user_ref,
        )
        text = str(context or "").strip()
        if retr_meta:
            sources = _enrich_sources_with_chunks(sources, retr_meta)
        return text[:max_chars] if text else "", sources
    except Exception:
        return "", sources


def fetch_reply_corpus_excerpt(
    *,
    user_ref: str,
    payload: dict[str, Any],
    query: str,
    max_chars: int = 6_000,
) -> str:
    """向后兼容：仅返回 excerpt 文本。"""
    excerpt, _ = fetch_reply_corpus_with_sources(
        user_ref=user_ref,
        payload=payload,
        query=query,
        max_chars=max_chars,
    )
    return excerpt


def build_compose_corpus_sources(
    *,
    user_ref: str,
    payload: dict[str, Any],
    query: str,
    max_chars: int = 4_000,
) -> list[dict[str, Any]]:
    """成稿/改版完成后构建可点击的资料 sources。"""
    _, sources = fetch_reply_corpus_with_sources(
        user_ref=user_ref,
        payload=payload,
        query=query,
        max_chars=max_chars,
        top_k=6,
    )
    return sources
