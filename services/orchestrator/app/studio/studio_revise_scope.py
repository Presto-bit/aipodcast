"""Studio revise scope：Planner 输出 + 规则推断。"""
from __future__ import annotations

import re
from typing import Any, Literal

from .patch_utils import infer_patch_scope

ReviseTier = Literal["preserve", "rephrase", "rewrite"]
VALID_TIERS: frozenset[str] = frozenset({"preserve", "rephrase", "rewrite"})

_FULL_REWRITE_SIGNAL = re.compile(r"重写|另起|全稿|整篇重写|全部重写|换一篇")
_VALID_BLOCKS = frozenset({"title", "body", "hashtags", "coverBrief", "interaction"})
_PRESERVE_SIGNAL = re.compile(r"润色|通顺|校对|错别字|改错|微调|别改结构|不要改结构")
_REPHRASE_SIGNAL = re.compile(r"降重|换说法|改写|换一种|同义|换个表达")
_REWRITE_SIGNAL = re.compile(r"重写这段|重写这|换风格|更犀利|更口语|大改|换种写法|重写标题|重写正文")


def normalize_revise_tier(raw: str | None) -> ReviseTier:
    t = str(raw or "").strip().lower()
    if t in VALID_TIERS:
        return t  # type: ignore[return-value]
    return "rephrase"


def infer_revise_tier(message: str, *, intent: str = "") -> ReviseTier:
    """从用户原话与 Planner intent 推断改写档位。"""
    blob = f"{message} {intent}".strip()
    if _PRESERVE_SIGNAL.search(blob):
        return "preserve"
    if _REWRITE_SIGNAL.search(blob):
        return "rewrite"
    if _REPHRASE_SIGNAL.search(blob):
        return "rephrase"
    return "rephrase"


def parse_revise_scope_from_llm(
    llm: dict[str, Any],
    *,
    message: str,
    selection_snippet: str = "",
    tier_override: str = "",
) -> dict[str, Any]:
    """合并 Planner reviseScope 与规则推断。"""
    raw = llm.get("reviseScope")
    blocks: list[str] = []
    intent = ""
    tier: ReviseTier = "rephrase"
    full_rewrite = bool(_FULL_REWRITE_SIGNAL.search(str(message or "")))
    if isinstance(raw, dict):
        for b in raw.get("blocks") or []:
            kind = str(b or "").strip()
            if kind in _VALID_BLOCKS and kind not in blocks:
                blocks.append(kind)
        intent = str(raw.get("intent") or "").strip()[:80]
        if raw.get("fullRewrite") is True:
            full_rewrite = True
        if raw.get("tier"):
            tier = normalize_revise_tier(str(raw.get("tier")))
    if tier_override.strip():
        tier = normalize_revise_tier(tier_override)
    elif not (isinstance(raw, dict) and raw.get("tier")):
        tier = infer_revise_tier(message, intent=intent)
    if not blocks:
        blocks = sorted(infer_patch_scope(message) & _VALID_BLOCKS)
    snippet = str(selection_snippet or "").strip()
    if snippet and "body" not in blocks:
        blocks.append("body")
    return {
        "blocks": blocks,
        "intent": intent,
        "tier": tier,
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
