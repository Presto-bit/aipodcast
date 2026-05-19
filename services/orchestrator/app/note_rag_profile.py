"""按资料类型选择切块参数（与 rag_core.split_* 配合）。"""
from __future__ import annotations

import os
from typing import Any


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)) or default)))
    except (TypeError, ValueError):
        return default


def rag_chunk_params_for_note(row: dict[str, Any] | None) -> dict[str, Any]:
    """
    返回 split_text_into_chunks / split_segments_into_chunks_with_meta 用的参数。
    prefer_segments: 有 ragChunkSegments 时是否优先结构化切段。
    """
    it = str((row or {}).get("input_type") or "").strip().lower()
    body_len = len(str((row or {}).get("content_text") or ""))

    if it in ("note_spreadsheet", "note_csv") or it.endswith("csv") or it.endswith("xlsx"):
        return {
            "max_chunk_chars": _int_env("RAG_CHUNK_CHARS_SHEET", 1400, 400, 4000),
            "overlap": _int_env("RAG_CHUNK_OVERLAP_SHEET", 40, 0, 400),
            "prefer_segments": True,
            "profile": "sheet",
        }
    if it in ("note_pdf", "note_file"):
        ext = ""
        md = (row or {}).get("metadata") or {}
        if isinstance(md, dict):
            ext = str(md.get("fileExt") or md.get("ext") or "").lower()
        if ext in ("pdf", "ppt", "pptx"):
            return {
                "max_chunk_chars": _int_env("RAG_CHUNK_CHARS_PDF", 900, 400, 3000),
                "overlap": _int_env("RAG_CHUNK_OVERLAP_PDF", 60, 0, 300),
                "prefer_segments": True,
                "profile": "pdf",
            }

    if body_len < 20_000:
        return {
            "max_chunk_chars": _int_env("RAG_CHUNK_CHARS_SHORT", 900, 400, 2000),
            "overlap": _int_env("RAG_CHUNK_OVERLAP_SHORT", 70, 0, 300),
            "prefer_segments": True,
            "profile": "short",
        }
    return {
        "max_chunk_chars": _int_env("RAG_CHUNK_CHARS", 1100, 400, 3000),
        "overlap": _int_env("RAG_CHUNK_OVERLAP", 90, 0, 400),
        "prefer_segments": True,
        "profile": "long",
    }


def query_suggests_table(query: str) -> bool:
    q = (query or "").strip()
    if not q:
        return False
    keys = ("表", "表格", "行列", "合计", "总计", "单元格", "列", "行", "table", "column", "row")
    return any(k in q.lower() or k in q for k in keys)
