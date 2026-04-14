"""
Parse uploaded note files (txt/md/pdf/docx/epub/…)；正文抽取见 note_document_extract。
"""
from __future__ import annotations

from app.note_document_extract import extract_text_from_bytes


def parse_note_temp_path(file_path: str, ext: str) -> str:
    """Return extracted plain text for preview/search (best effort)."""
    try:
        with open(file_path, "rb") as f:
            data = f.read()
    except Exception:
        return ""
    return extract_text_from_bytes(data, ext).text
