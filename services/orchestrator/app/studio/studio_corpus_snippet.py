"""Studio reply 路径：轻量资料检索 excerpt。"""
from __future__ import annotations

from typing import Any

from ..social_publish_draft import resolve_social_publish_material
from .studio_constants import STUDIO_CORPUS_MAX_NOTE_IDS


def fetch_reply_corpus_excerpt(
    *,
    user_ref: str,
    payload: dict[str, Any],
    query: str,
    max_chars: int = 6_000,
) -> str:
    """reply + 勾选资料时检索 top 段落，供 studio_reply grounding。"""
    raw = payload.get("noteIds") or payload.get("selected_note_ids") or []
    if not isinstance(raw, list):
        return ""
    nids = [str(x).strip() for x in raw if str(x).strip()][:STUDIO_CORPUS_MAX_NOTE_IDS]
    if not nids:
        return ""
    notebook = str(payload.get("notebook") or payload.get("notes_notebook") or "").strip()
    owner = str(payload.get("notes_source_owner_user_id") or "").strip() or None
    hint = f"{query.strip()[:400]} {notebook}".strip()
    try:
        material = resolve_social_publish_material(
            user_ref,
            selected_note_ids=nids,
            material_text=query,
            notes_source_owner_user_id=owner,
            use_rag=True,
            rag_max_chars=max_chars,
            reference_rag_mode=str(payload.get("reference_rag_mode") or "truncate"),
            material_hint=hint[:500],
            source_type="notes_rag",
        )
        text = str(material or "").strip()
        return text[:max_chars] if text else ""
    except Exception:
        return ""
