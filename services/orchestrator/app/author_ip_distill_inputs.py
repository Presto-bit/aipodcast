"""风格提炼输入：复用知识库解析 / 预处理 / RAG 索引产物，减少重复灌全文。"""
from __future__ import annotations

import hashlib
from typing import Any


def note_content_fingerprint(body: str, note_rag_body_hash: str | None = None) -> str:
    h = str(note_rag_body_hash or "").strip()
    if h:
        return h[:64]
    raw = (body or "").encode("utf-8", errors="ignore")[:12_000]
    return hashlib.sha256(raw).hexdigest()[:16]


def build_distill_excerpt(
    *,
    body: str,
    note_summary: str = "",
    preprocess_summary: str = "",
    rag_chunk_texts: list[str] | None = None,
    max_fallback_body: int = 6000,
) -> tuple[str, str]:
    """
    返回 (distill_text, source_kind)。
    source_kind: rag_indexed | preprocess | full_body
    """
    parts: list[str] = []
    summary = (note_summary or "").strip()
    pre = (preprocess_summary or "").strip()
    if summary:
        parts.append(f"【机器摘要】{summary[:900]}")
    elif pre:
        parts.append(f"【预处理摘要】{pre[:500]}")
    chunks = [str(c).strip() for c in (rag_chunk_texts or []) if str(c).strip()]
    for i, chunk in enumerate(chunks[:3], 1):
        parts.append(f"【索引片段{i}】{chunk[:1400]}")
    if parts:
        if chunks or summary:
            kind = "rag_indexed"
        else:
            kind = "preprocess"
        return "\n\n".join(parts), kind
    fallback = (body or "").strip()[:max_fallback_body]
    return fallback, "full_body" if fallback else ""


def material_has_distill_input(m: dict[str, Any]) -> bool:
    if str(m.get("distillBody") or "").strip():
        return True
    if str(m.get("noteSummary") or "").strip():
        return True
    if int(m.get("ragChunkCount") or 0) > 0:
        return True
    if str(m.get("preprocessSummary") or "").strip():
        return True
    return bool(str(m.get("body") or "").strip())
