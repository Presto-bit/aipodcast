"""解析质量评估、parseGate、structuredBlocks 与 pageBreaks。"""
from __future__ import annotations

import os
import re
from typing import Any

from .note_document_extract import NoteParseResult


def _env_bool(name: str, default: bool) -> bool:
    return (os.getenv(name, "1" if default else "0") or "").strip().lower() not in (
        "0",
        "false",
        "off",
        "no",
    )


def parse_gate_block_index_enabled() -> bool:
    return _env_bool("NOTE_PARSE_GATE_BLOCK_INDEX", True)


def pdf_ocr_enabled() -> bool:
    return _env_bool("NOTE_PDF_OCR_ENABLED", False)


def compute_parse_quality(
    parse_result: NoteParseResult,
    *,
    content_text: str,
    ext: str = "",
) -> dict[str, Any]:
    text = (content_text or "").strip()
    issues: list[str] = []
    page_count = 0
    chars_per_page = 0.0

    segs = getattr(parse_result, "rag_segments", None) or []
    if isinstance(segs, list):
        for s in segs:
            if isinstance(s, dict):
                meta = s.get("meta") if isinstance(s.get("meta"), dict) else {}
                if meta.get("page") is not None:
                    try:
                        page_count = max(page_count, int(meta["page"]))
                    except (TypeError, ValueError):
                        pass

    detail = str(parse_result.detail or "")
    if "扫描版" in detail or "scanned" in detail.lower():
        issues.append("scanned_pdf")
    if parse_result.status == "error":
        issues.append("parse_error")
    if parse_result.status == "empty":
        issues.append("empty_body")

    eng = str(parse_result.engine or "")
    if page_count > 0:
        chars_per_page = len(text) / max(1, page_count)
        if chars_per_page < 80:
            issues.append("low_char_per_page")

    for s in segs[:200] if isinstance(segs, list) else []:
        if not isinstance(s, dict):
            continue
        meta = s.get("meta") if isinstance(s.get("meta"), dict) else {}
        bt = str(meta.get("block_type") or "")
        if bt == "table" and "\t" in str(s.get("text") or "") and "|" not in str(s.get("text") or ""):
            issues.append("table_as_tsv")
            break

    score = 100
    if "scanned_pdf" in issues or "parse_error" in issues:
        score = 0
    elif "empty_body" in issues:
        score = 5
    elif "low_char_per_page" in issues:
        score = 35
    elif "table_as_tsv" in issues:
        score = max(score - 15, 50)
    if len(text) < 120:
        score = min(score, 40)

    return {
        "score": score,
        "issues": issues,
        "engine": eng,
        "pageCount": page_count,
        "charsPerPage": round(chars_per_page, 1),
        "ext": (ext or "").lower().lstrip("."),
    }


def parse_gate_from_quality(
    parse_result: NoteParseResult,
    *,
    content_text: str,
    parse_error_code: str = "",
) -> str:
    """blocked | limited | ready"""
    if parse_error_code in ("scanned_pdf", "encrypted_pdf", "parse_failed"):
        return "blocked"
    if parse_result.status in ("error", "empty"):
        return "blocked"
    text = (content_text or "").strip()
    if len(text) < 8:
        return "blocked"
    q = compute_parse_quality(parse_result, content_text=text)
    if q.get("score", 0) < 20:
        return "blocked"
    if len(text) < 120 or q.get("score", 0) < 55:
        return "limited"
    return "ready"


def attach_char_offsets_to_segments(
    full_text: str,
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """为 rag_segments 写入 meta.char_start / char_end（相对全文）。"""
    if not full_text or not segments:
        return segments
    cursor = 0
    out: list[dict[str, Any]] = []
    for raw in segments:
        seg = dict(raw) if isinstance(raw, dict) else {"text": str(raw)}
        txt = str(seg.get("text") or "")
        meta = dict(seg.get("meta") or {}) if isinstance(seg.get("meta"), dict) else {}
        if not txt.strip():
            out.append({**seg, "meta": meta})
            continue
        pos = full_text.find(txt, cursor)
        if pos < 0:
            pos = full_text.find(txt.strip()[: min(80, len(txt))], cursor)
        if pos < 0:
            meta.setdefault("char_start", cursor)
            meta.setdefault("char_end", cursor + len(txt))
            cursor += len(txt) + 1
        else:
            meta["char_start"] = pos
            meta["char_end"] = pos + len(txt)
            cursor = pos + len(txt)
        out.append({**seg, "meta": meta})
    return out


def structured_blocks_from_rag_segments(
    segments: list[dict[str, Any]],
    *,
    limit: int = 800,
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for i, raw in enumerate(segments[:limit]):
        if not isinstance(raw, dict):
            continue
        txt = str(raw.get("text") or "").strip()
        if not txt:
            continue
        meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
        bt = str(meta.get("block_type") or "paragraph").lower()
        hp = meta.get("heading_path")
        heading = ""
        if isinstance(hp, list) and hp:
            heading = str(hp[-1] or "").strip()
        page = meta.get("page")
        cs = meta.get("char_start")
        ce = meta.get("char_end")
        bid = f"seg-{i + 1}"
        if bt in ("pdf_page",) and page is not None:
            blocks.append({
                "id": bid,
                "type": "page",
                "text": f"第 {page} 页",
                "page": int(page) if str(page).isdigit() else page,
                **({"charStart": int(cs), "charEnd": int(ce)} if cs is not None and ce is not None else {}),
            })
            if len(txt) > 20:
                blocks.append({
                    "id": f"{bid}-body",
                    "type": "paragraph",
                    "text": txt[:12_000],
                    "page": page,
                    **({"charStart": int(cs), "charEnd": int(ce)} if cs is not None and ce is not None else {}),
                })
            continue
        if bt == "table" or bt in ("csv", "xlsx", "sheet", "xls"):
            blocks.append({
                "id": bid,
                "type": "table",
                "text": txt[:16_000],
                "page": page,
                **({"charStart": int(cs), "charEnd": int(ce)} if cs is not None and ce is not None else {}),
            })
            continue
        if heading and bt != "paragraph":
            lvl = 2
            blocks.append({
                "id": bid,
                "type": "heading",
                "level": lvl,
                "text": heading,
                "page": page,
            })
        typ = "list_item" if bt == "list" else "paragraph"
        blocks.append({
            "id": bid,
            "type": typ,
            "text": txt[:12_000],
            "page": page,
            **({"charStart": int(cs), "charEnd": int(ce)} if cs is not None and ce is not None else {}),
        })
    return blocks


def page_breaks_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, int]]:
    seen: dict[int, int] = {}
    for raw in segments or []:
        if not isinstance(raw, dict):
            continue
        meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
        try:
            page = int(meta.get("page"))
            cs = int(meta.get("char_start"))
        except (TypeError, ValueError):
            continue
        if page > 0 and page not in seen:
            seen[page] = cs
    return [{"page": p, "charStart": seen[p]} for p in sorted(seen.keys())]


def merge_upload_parse_metadata(
    extra_meta: dict[str, object],
    parse_result: NoteParseResult,
    *,
    content_text: str,
    ext: str,
    parse_error_code: str = "",
) -> None:
    rs = getattr(parse_result, "rag_segments", None)
    if isinstance(rs, list) and rs:
        segs = attach_char_offsets_to_segments(content_text, rs[:3000])
        extra_meta["ragChunkSegments"] = segs
        extra_meta["structuredBlocks"] = structured_blocks_from_rag_segments(segs)
    pq = compute_parse_quality(parse_result, content_text=content_text, ext=ext)
    extra_meta["parseQuality"] = pq
    extra_meta["parseGate"] = parse_gate_from_quality(
        parse_result, content_text=content_text, parse_error_code=parse_error_code
    )
