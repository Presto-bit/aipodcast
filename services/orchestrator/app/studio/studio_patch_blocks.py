"""Studio 块级 patch_blocks：小 prompt 只改指定块。"""
from __future__ import annotations

import json
import uuid
from typing import Any

from ..social_llm_utils import invoke_social_llm, parse_json_object
from .domain_profile import domain_author_overlay
from .patch_utils import mask_proposed_to_scope
from .studio_revise_scope import normalize_revise_tier, scopes_to_block_kinds

_TIER_CONFIG: dict[str, dict[str, Any]] = {
    "preserve": {
        "label": "保守润色",
        "temperature": 0.35,
        "max_tokens": 900,
        "rules": [
            "禁止改变段落顺序与段落数量。",
            "禁止增删论点、事实与例子。",
            "仅修正语法、用词与标点，使表达更通顺。",
        ],
    },
    "rephrase": {
        "label": "标准改写",
        "temperature": 0.65,
        "max_tokens": 1200,
        "rules": [
            "保留全部事实、结构与关键信息。",
            "句式与用词应有明显变化（约 40% 以上），避免简单同义词替换堆砌。",
            "可微调句序，但不要合并或拆分段落。",
        ],
    },
    "rewrite": {
        "label": "强力重写",
        "temperature": 0.85,
        "max_tokens": 1600,
        "rules": [
            "保留主题、核心事实与结论，可重组段落与论证顺序。",
            "语气与钩子可大幅调整，但不要换题或引入原文没有的新事实。",
            "允许重写开头与过渡句，使整体更贴合用户意见。",
        ],
    },
}


def _blocks_to_context(blocks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        kind = str(b.get("kind") or "").strip()
        if kind == "title":
            parts.append(f"标题：{str(b.get('text') or '').strip()}")
        elif kind == "body":
            parts.append(f"正文：\n{str(b.get('text') or '').strip()}")
        elif kind == "hashtags":
            tags = b.get("tags")
            if isinstance(tags, list):
                parts.append("话题：" + " ".join(f"#{str(t).lstrip('#')}" for t in tags if str(t).strip()))
        elif kind == "coverBrief":
            parts.append(f"封面：{str(b.get('text') or '').strip()}")
        elif kind == "interaction":
            parts.append(f"互动：{str(b.get('text') or '').strip()}")
    return "\n\n".join(parts).strip()[:6000]


def _merge_patch_into_blocks(
    base_blocks: list[dict[str, Any]],
    patch: dict[str, Any],
    scopes: set[str],
) -> list[dict[str, Any]]:
    proposed: list[dict[str, Any]] = []
    for b in base_blocks:
        if not isinstance(b, dict):
            continue
        kind = str(b.get("kind") or "").strip()
        bid = str(b.get("id") or uuid.uuid4())
        if kind == "title" and "title" in scopes:
            text = str(patch.get("title") or b.get("text") or "").strip()
            proposed.append({**b, "id": bid, "kind": "title", "text": text})
        elif kind == "body" and "body" in scopes:
            text = str(patch.get("body") or b.get("text") or "").strip()
            proposed.append({**b, "id": bid, "kind": "body", "text": text})
        elif kind == "hashtags" and "hashtags" in scopes:
            raw_tags = patch.get("hashtags")
            tags = b.get("tags") if isinstance(b.get("tags"), list) else []
            if isinstance(raw_tags, list):
                tags = [str(t).replace("#", "").strip() for t in raw_tags if str(t).strip()]
            proposed.append({**b, "id": bid, "kind": "hashtags", "tags": tags})
        elif kind == "coverBrief" and "coverBrief" in scopes:
            text = str(patch.get("coverBrief") or b.get("text") or "").strip()
            proposed.append({**b, "id": bid, "kind": "coverBrief", "text": text})
        elif kind == "interaction" and "interaction" in scopes:
            text = str(patch.get("interaction") or b.get("text") or "").strip()
            proposed.append({**b, "id": bid, "kind": "interaction", "text": text})
        else:
            proposed.append(dict(b))
    if "title" in scopes and not any(str(x.get("kind")) == "title" for x in proposed):
        text = str(patch.get("title") or "").strip()
        if text:
            proposed.insert(0, {"id": "title-0", "kind": "title", "text": text})
    if "body" in scopes and not any(str(x.get("kind")) == "body" for x in proposed):
        text = str(patch.get("body") or "").strip()
        if text:
            proposed.append({"id": "body-0", "kind": "body", "text": text})
    return proposed


def build_revise_executor_prompt(
    *,
    message: str,
    scopes: set[str],
    manuscript_context: str,
    selection_snippet: str = "",
    intent: str = "",
    tier: str = "rephrase",
    domain: str = "general",
) -> tuple[str, str]:
    tier_key = normalize_revise_tier(tier)
    cfg = _TIER_CONFIG[tier_key]
    scope_list = ", ".join(sorted(scopes))
    domain_hint = domain_author_overlay({"domain": domain, "format": "general"})
    rule_lines = "\n".join(f"- {line}" for line in cfg["rules"])
    system = "\n".join(
        [
            "你是稿件局部改版助手。只修改用户指定的块，输出一个 JSON 对象。",
            f"改写档位：{cfg['label']}（{tier_key}）。",
            f"允许修改的块：{scope_list}。",
            "JSON 键仅可包含：title, body, hashtags(数组), coverBrief, interaction。",
            "只输出 JSON，不要 markdown，不要解释。",
            "档位约束：",
            rule_lines,
            domain_hint,
        ]
    )
    chunks = [f"改版意见：{message.strip()[:800]}"]
    if intent.strip():
        chunks.append(f"意图：{intent.strip()}")
    if selection_snippet.strip():
        chunks.append(f"选区片段：「{selection_snippet.strip()[:400]}」")
    chunks.extend(["", "【当前稿件】", manuscript_context[:5000]])
    return system, "\n".join(chunks)


def execute_patch_blocks(
    *,
    message: str,
    from_blocks: list[dict[str, Any]],
    revise_scope: dict[str, Any],
    selection_snippet: str = "",
    domain: str = "general",
) -> list[dict[str, Any]]:
    """块级局部改版：小 LLM 只输出变更块，再 merge + mask。"""
    scopes = scopes_to_block_kinds(revise_scope)
    if not scopes or not from_blocks:
        return list(from_blocks)
    tier = normalize_revise_tier(str(revise_scope.get("tier") or "rephrase"))
    cfg = _TIER_CONFIG[tier]
    context = _blocks_to_context(from_blocks)
    system, user = build_revise_executor_prompt(
        message=message,
        scopes=scopes,
        manuscript_context=context,
        selection_snippet=selection_snippet,
        intent=str(revise_scope.get("intent") or ""),
        tier=tier,
        domain=domain,
    )
    try:
        raw, _ = invoke_social_llm(
            system,
            user,
            max_tokens=int(cfg["max_tokens"]),
            temperature=float(cfg["temperature"]),
        )
        parsed = parse_json_object(str(raw or ""))
        if not isinstance(parsed, dict):
            return mask_proposed_to_scope(from_blocks, list(from_blocks), scopes)
        merged = _merge_patch_into_blocks(from_blocks, parsed, scopes)
        return mask_proposed_to_scope(from_blocks, merged, scopes)
    except Exception:
        return list(from_blocks)
