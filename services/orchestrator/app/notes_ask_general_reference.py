"""知识库问答「通识参考」文案常量（阶段 2 补充，与前端 notesAskGeneralReference.ts 对齐）。"""
from __future__ import annotations

import re

GENERAL_REFERENCE_HEADING = "## 通识参考（非资料原文，请自行核实）"

_GENERAL_REFERENCE_HEADING_RE = re.compile(
    r"^#+\s*(?:通识参考|补充说明)[^\n]*\n+",
    re.MULTILINE,
)


def normalize_general_reference_heading(text: str) -> str:
    """将旧版「补充说明」标题规范为「通识参考」。"""
    t = (text or "").strip()
    if not t:
        return ""
    if _GENERAL_REFERENCE_HEADING_RE.search(t):
        body = _GENERAL_REFERENCE_HEADING_RE.sub("", t, count=1).strip()
        return f"{GENERAL_REFERENCE_HEADING}\n\n{body}" if body else GENERAL_REFERENCE_HEADING
    return t
