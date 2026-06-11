"""Studio reply 生成：按 intent 分档（运营 memo / 解读稿 / 一般问答）。"""
from __future__ import annotations

import re
from typing import Literal

from ..social_llm_utils import invoke_social_llm
from .agent_route import is_manuscript_read_intent
from .studio_constants import STUDIO_MANUSCRIPT_EXCERPT_CHARS, STUDIO_USER_REPLY_MAX_CHARS

OPS_SIGNAL = re.compile(
    r"运营|策略|涨粉|流量|算法|什么时候发|怎么推|推广方案|发布计划|发布节奏|发布后|怎么发|冷启动|起号"
)

ReplyTier = Literal["ops", "manuscript_coach", "manuscript_general", "general"]

_TIER_LIMITS: dict[ReplyTier, tuple[int, int]] = {
    "ops": (900, 2400),
    "manuscript_coach": (750, 1800),
    "manuscript_general": (550, 1200),
    "general": (400, 900),
}


def is_ops_strategy_question(message: str) -> bool:
    return bool(OPS_SIGNAL.search(str(message or "").strip()))


def classify_reply_tier(
    message: str,
    *,
    has_manuscript: bool,
    manuscript_excerpt: str = "",
) -> ReplyTier:
    if is_ops_strategy_question(message):
        return "ops"
    grounded = has_manuscript or bool(manuscript_excerpt.strip())
    if not grounded:
        return "general"
    if is_manuscript_read_intent(message) or re.search(
        r"为什么|为何|什么意思|怎么样|评价|优缺点|这段|这篇", message.strip()
    ):
        return "manuscript_coach"
    return "manuscript_general"


def _clip_excerpt(excerpt: str) -> str:
    return excerpt.strip()[:STUDIO_MANUSCRIPT_EXCERPT_CHARS]


def _build_user_blob(
    *,
    message: str,
    manuscript_excerpt: str,
    feature_summary: str,
) -> str:
    chunks = [f"用户问题：{message.strip()[:800]}"]
    clipped = _clip_excerpt(manuscript_excerpt)
    if clipped:
        chunks.extend(["", "【当前稿件】", clipped])
    if feature_summary.strip():
        chunks.extend(["", f"【作者偏好】{feature_summary.strip()[:240]}"])
    return "\n".join(chunks)


def _system_for_tier(tier: ReplyTier, *, grounded: bool) -> str:
    if tier == "ops":
        if grounded:
            return "\n".join(
                [
                    "你是小红书运营顾问。用户已有成稿，请输出「针对本篇笔记」的运营 memo。",
                    "Markdown，约 400–800 字；不要输出新稿正文；不要 JSON。",
                    "须含：这篇在推什么（「」引用原句）、适合谁、3 条绑定稿内关键词的发布动作、1 条不建议、下一步。",
                    "禁止与稿无关的泛建议；禁止「画布」「稿件主题」。",
                ]
            )
        return "\n".join(
            [
                "你是小红书运营顾问。用户尚无成稿，给平台级框架（200–400 字 Markdown）。",
                "开头写明「以下为通用框架（尚未绑定具体笔记）」；末尾提示先写成稿后可给针对性方案。",
            ]
        )
    if tier == "manuscript_coach":
        return "\n".join(
            [
                "你是创作教练。用户已有成稿，请解读/总结/评价（Markdown，约 400–800 字）。",
                "必须引用至少 2 处稿内原文（用「」）；说明结构、语气、钩子与可改进点。",
                "不要输出完整新稿；不要 JSON；禁止「画布」「稿件主题」。",
                "若用户应改稿，提示在输入框描述改版意见。",
            ]
        )
    if tier == "manuscript_general":
        return "\n".join(
            [
                "你是小红书创作助手。用户已有成稿，请结合正文回答（Markdown，约 200–500 字）。",
                "至少 1 处「」引用；不要输出完整新稿；不要 JSON。",
            ]
        )
    return "\n".join(
        [
            "你是小红书创作助手。直接回答用户问题（Markdown，约 150–400 字）。",
            "不要输出完整笔记正文；不要 JSON。",
            "无稿件时禁止要求用户提供画布主题；可提示在下方描述成稿需求。",
        ]
    )


def _fallback_for_tier(tier: ReplyTier, excerpt: str) -> str:
    if tier == "ops":
        if excerpt.strip():
            snippet = excerpt.strip()[:200].replace("\n", " ")
            return "\n".join(
                [
                    "（未能生成完整运营方案，以下为基于当前稿件的简要建议）",
                    "",
                    f"**稿件摘要**：{snippet}…",
                    "",
                    "可以说「按运营建议改标题」或「写一条首评」。",
                ]
            )
        return "\n".join(
            [
                "以下为通用框架（尚未绑定具体笔记）。",
                "发布时间：工作日晚 20–22 点；首发 30 分钟内留首评。",
                "先描述成稿需求，我可结合正文给针对性方案。",
            ]
        )
    if tier in ("manuscript_coach", "manuscript_general"):
        return "可以在下方输入更具体的改稿意见，我会直接修改稿件。"
    return "可以在下方描述想写的内容或继续提问。"


def generate_studio_reply(
    message: str,
    *,
    has_manuscript: bool,
    manuscript_excerpt: str = "",
    task_sentence: str = "",
    feature_summary: str = "",
) -> str:
    """reply 统一入口：按 tier 选 max_tokens 与输出上限。"""
    _ = task_sentence
    excerpt = _clip_excerpt(manuscript_excerpt)
    grounded = has_manuscript or bool(excerpt)
    tier = classify_reply_tier(message, has_manuscript=has_manuscript, manuscript_excerpt=excerpt)
    max_tokens, out_cap = _TIER_LIMITS[tier]
    system = _system_for_tier(tier, grounded=grounded)
    user = _build_user_blob(message=message, manuscript_excerpt=excerpt, feature_summary=feature_summary)
    try:
        raw, _ = invoke_social_llm(system, user, max_tokens=max_tokens)
        text = str(raw or "").strip()
        if text and not re.search(r"画布上稿件|请先提供.*主题|内容方向", text):
            cap = min(out_cap, STUDIO_USER_REPLY_MAX_CHARS)
            if tier == "ops" and grounded and text.count("「") < 2 and excerpt:
                text = f"{text}\n\n（提示：请与正文「{excerpt[:40].replace(chr(10), ' ')}…」对照执行。）"
            return text[:cap]
    except Exception:
        pass
    return _fallback_for_tier(tier, excerpt)


# 向后兼容
generate_ops_strategy_reply = generate_studio_reply
