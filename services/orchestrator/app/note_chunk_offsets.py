"""为向量块写入全文 char_start / char_end，供角标跳转。"""
from __future__ import annotations

from typing import Any


def attach_char_offsets_to_chunks(
    body: str,
    chunks: list[str],
    metas: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """按顺序在正文中查找块文本，写入 chunk_meta.char_start / char_end。"""
    if not body or not chunks:
        return metas
    out: list[dict[str, Any]] = []
    cursor = 0
    for i, ch in enumerate(chunks):
        meta = dict(metas[i]) if i < len(metas) and isinstance(metas[i], dict) else {}
        piece = (ch or "").strip()
        if not piece:
            out.append(meta)
            continue
        pos = body.find(piece, cursor)
        if pos < 0:
            pos = body.find(piece[: min(80, len(piece))], cursor)
        if pos < 0:
            meta.setdefault("char_start", cursor)
            meta.setdefault("char_end", min(len(body), cursor + len(piece)))
            cursor = meta["char_end"]
        else:
            end = pos + len(piece)
            meta["char_start"] = pos
            meta["char_end"] = end
            cursor = max(cursor, end)
        out.append(meta)
    while len(out) < len(chunks):
        out.append({})
    return out
