"""
Parse uploaded note files (txt/md/pdf/docx/epub/…); reuses legacy backend parsers when available.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
import zipfile
from typing import Any


def parse_note_temp_path(file_path: str, ext: str) -> str:
    """Return extracted plain text for preview/search (best effort)."""
    normalized_ext = str(ext or "").lower()
    try:
        from app.fyv_shared.content_parser import content_parser
    except Exception:
        content_parser = None  # type: ignore

    if normalized_ext == "pdf" and content_parser:
        result = content_parser.parse_pdf(file_path)
        return str(result.get("content") or "") if result.get("success") else ""
    if normalized_ext == "epub" and content_parser:
        result = content_parser.parse_epub(file_path)
        return str(result.get("content") or "") if result.get("success") else ""
    if normalized_ext == "docx":
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                xml_data = zf.read("word/document.xml").decode("utf-8", errors="ignore")
            text = re.sub(r"</w:p>", "\n", xml_data)
            text = re.sub(r"<[^>]+>", "", text)
            return re.sub(r"\n{2,}", "\n", text).strip()
        except Exception:
            return ""
    if normalized_ext == "doc":
        return _parse_doc_binary_with_fallback(file_path)
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception:
        return ""


def _parse_doc_binary_with_fallback(path: str) -> str:
    candidates: list[tuple[list[str], str]] = [
        (["antiword", path], "antiword"),
        (["catdoc", path], "catdoc"),
    ]
    for cmd, _name in candidates:
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if proc.returncode == 0:
                txt = (proc.stdout or "").strip()
                if txt:
                    return txt
        except Exception:
            continue
    try:
        out_dir = os.path.dirname(path)
        proc = subprocess.run(
            ["soffice", "--headless", "--convert-to", "txt:Text", "--outdir", out_dir, path],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.returncode == 0:
            txt_path = os.path.splitext(path)[0] + ".txt"
            if os.path.exists(txt_path):
                with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
                    txt = f.read().strip()
                try:
                    os.remove(txt_path)
                except OSError:
                    pass
                if txt:
                    return txt
    except Exception:
        pass
    return ""
