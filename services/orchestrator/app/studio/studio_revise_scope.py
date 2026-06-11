"""Studio revise scope：Planner 输出 + 规则推断。"""
from __future__ import annotations

import re
from typing import Any

from .patch_utils import infer_patch_scope

_FULL_REWRITE_SIGNAL = re.compile(r"重写|另起|全稿|整篇重写|全部重写|换一篇")
_VALID_BLOCKS = frozenset({"title", "body", "hashtags", "coverBrief", "interaction"})


def parse_revise_scope_from_llm(
    llm: dict[str, Any],
    *,
    message: str,
    selection_snippet: str = "",
) -> dict[str, Any]:
    """合并 Planner reviseScope 与规则推断。"""
    raw = llm.get("reviseScope")
    blocks: list[str] = []
    intent = ""
    full_rewrite = bool(_FULL_REWRITE_SIGNAL.search(str(message or "")))
    if isinstance(raw, dict):
        for b in raw.get("blocks") or []:
            kind = str(b or "").strip()
            if kind in _VALID_BLOCKS and kind not in blocks:
                blocks.append(kind)
        intent = str(raw.get("intent") or "").strip()[:80]
        if raw.get("fullRewrite") is True:
            full_rewrite = True
    if not blocks:
        blocks = sorted(infer_patch_scope(message) & _VALID_BLOCKS)
    snippet = str(selection_snippet or "").strip()
    if snippet and "body" not in blocks:
        blocks.append("body")
    return {
        "blocks": blocks,
        "intent": intent,
        "fullRewrite": full_rewrite,
    }


def is_local_patch_scope(scope: dict[str, Any]) -> bool:
    """块级局部改：非全稿重写且有明确 block scope。"""
    if scope.get("fullRewrite"):
        return False
    blocks = scope.get("blocks") or []
    return bool(blocks)


def scopes_to_block_kinds(scope: dict[str, Any]) -> set[str]:
    return {str(b).strip() for b in (scope.get("blocks") or []) if str(b).strip() in _VALID_BLOCKS}
