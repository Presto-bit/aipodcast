"""知识库问答正文角标合并（论点块级，无重依赖）。"""
from __future__ import annotations

import re

_CITATION_TAIL_GROUP_RE = re.compile(
    r"(?P<cites>(?:\s*\[\d+\])+)\s*[。．.!?，,、；;：:）)】」』\"'\]]*\s*$"
)
_LIST_ITEM_LINE_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")


def _extract_tail_citation_indexes(line: str) -> tuple[str, tuple[str, ...], str]:
    raw = line.rstrip()
    m = _CITATION_TAIL_GROUP_RE.search(raw)
    if not m:
        return line, (), ""
    cites_part = m.group("cites") or ""
    punct = raw[m.start() + len(cites_part) :]
    body = raw[: m.start()].rstrip()
    nums = re.findall(r"\[(\d+)\]", cites_part)
    seen: set[str] = set()
    deduped: list[str] = []
    for c in nums:
        if c in seen:
            continue
        seen.add(c)
        deduped.append(c)
    return body, tuple(deduped), punct


def _attach_tail_citations(body: str, cites: tuple[str, ...], *, trailing_punct: str = "") -> str:
    if not cites:
        return body
    tail = "".join(f"[{c}]" for c in cites) + trailing_punct
    if not body.strip():
        return tail
    return f"{body.rstrip()} {tail}"


def _collapse_citation_block(block: str) -> str:
    if not block.strip():
        return block
    lines = block.split("\n")
    parsed = [_extract_tail_citation_indexes(ln) for ln in lines]

    i = 0
    while i < len(lines):
        if not _LIST_ITEM_LINE_RE.match(lines[i] or ""):
            i += 1
            continue
        j = i
        while j < len(lines) and (
            not (lines[j] or "").strip() or _LIST_ITEM_LINE_RE.match(lines[j] or "")
        ):
            j += 1
        run_idxs = [
            k
            for k in range(i, j)
            if (lines[k] or "").strip() and _LIST_ITEM_LINE_RE.match(lines[k] or "")
        ]
        cited = [k for k in run_idxs if parsed[k][1]]
        if len(cited) >= 2:
            cite_sets = [parsed[k][1] for k in cited]
            if all(cs == cite_sets[0] for cs in cite_sets):
                for k in cited[:-1]:
                    parsed[k] = (parsed[k][0], (), "")
        i = j

    cited_lines = [(idx, parsed[idx]) for idx in range(len(lines)) if parsed[idx][1]]
    if len(cited_lines) >= 2:
        cite_sets = [cites for _, (_, cites, _) in cited_lines]
        if all(cs == cite_sets[0] for cs in cite_sets):
            last_idx = cited_lines[-1][0]
            last_punct = parsed[last_idx][2]
            for idx, (body, _, _) in cited_lines[:-1]:
                parsed[idx] = (body, (), "")
            parsed[last_idx] = (parsed[last_idx][0], parsed[last_idx][1], last_punct)

    for idx in range(len(lines) - 1):
        if parsed[idx][1] and parsed[idx][1] == parsed[idx + 1][1]:
            parsed[idx] = (parsed[idx][0], (), "")

    return "\n".join(
        _attach_tail_citations(body, cites, trailing_punct=punct) for body, cites, punct in parsed
    )


def collapse_citation_markers(text: str) -> str:
    """
    合并冗余 [n]：同段/同列表块内重复角标收束到块末，相邻行重复角标去前留后。
    不改动不同来源的并列 [1][2] 组合。
    """
    if not text or "[" not in text:
        return text
    parts = re.split(r"(\n{2,})", text)
    if len(parts) == 1:
        return _collapse_citation_block(text)
    out: list[str] = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            out.append(part)
        else:
            out.append(_collapse_citation_block(part))
    return "".join(out)
