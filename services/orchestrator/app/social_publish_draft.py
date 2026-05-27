"""知识库「发布到自媒体」：按平台与勾选项将素材改写为可复制的发布稿（固定 DeepSeek，不走平台 API）。"""
from __future__ import annotations

import json
import logging
from typing import Any

from .social_compliance import apply_compliance_to_mp_fields
from .social_llm_utils import invoke_social_llm, normalize_tags, parse_json_object
from .social_xhs import build_persona_prompt_block, finalize_xhs_pack

logger = logging.getLogger(__name__)

_INTENT_CN = {
    "zhongcao": "种草推荐",
    "dry_goods": "干货科普",
    "opinion": "观点评论",
    "checklist": "清单合集",
    "story": "故事经历",
}
_AUDIENCE_CN = {
    "beginner": "入门小白",
    "general": "普通读者",
    "pro": "行业从业者",
}
_LENGTH_CN_LEGACY = {
    "short": 400,
    "medium": 600,
    "long": 1500,
}


def _resolve_target_chars(options: dict[str, Any]) -> int:
    raw = options.get("target_chars")
    if isinstance(raw, int) and raw > 0:
        return min(5000, max(200, raw))
    if isinstance(raw, float) and raw > 0:
        return min(5000, max(200, int(raw)))
    if isinstance(raw, str) and raw.strip().isdigit():
        return min(5000, max(200, int(raw.strip())))
    leg = str(options.get("length") or "").strip()
    return _LENGTH_CN_LEGACY.get(leg, 600)


_TONE_CN = {
    "casual": "亲切口语",
    "pro": "专业克制",
    "humor": "幽默轻松",
    "motivational": "热血励志",
}


def _options_prompt_block(options: dict[str, Any], platform: str) -> str:
    intent = _INTENT_CN.get(str(options.get("intent") or "").strip(), "干货科普")
    audience = _AUDIENCE_CN.get(str(options.get("audience") or "").strip(), "普通读者")
    target_chars = _resolve_target_chars(options)
    tone = _TONE_CN.get(str(options.get("tone") or "").strip(), "亲切口语")
    extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}
    must = extras.get("mustInclude") if isinstance(extras.get("mustInclude"), list) else []
    avoid = extras.get("avoid") if isinstance(extras.get("avoid"), list) else []
    note = str(options.get("userNote") or extras.get("userNote") or "").strip()[:500]

    lines = [
        f"【内容目标】{intent}",
        f"【读者】{audience}",
        f"【语气】{tone}",
        f"【目标字数】约 {target_chars} 字（正文主体，不含标题与话题）",
    ]
    if must:
        lines.append(f"【必须包含】{', '.join(str(x) for x in must[:8])}")
    if avoid:
        lines.append(f"【规避】{', '.join(str(x) for x in avoid[:8])}")
    persona = options.get("persona") if isinstance(options.get("persona"), dict) else None
    if persona:
        lines.append(build_persona_prompt_block(options))
    elif platform == "wechat_mp":
        lines.append("【读者】公众号订阅用户，重可读性与转发价值")
    if note:
        lines.append(f"【用户补充】{note}")
    return "\n".join(lines)


def _fallback_xhs() -> dict[str, Any]:
    return {
        "titles": [
            "打工人熬夜党！百元搞定暗沉",
            "熬夜脸急救｜3步稳住状态",
            "不看亏大！暗沉肌自救笔记",
        ],
        "cover_hook": "打工人熬夜党！百元搞定暗沉",
        "opening_30": "你是不是也一到下午就脸垮？",
        "body": "📌 先说结论：先把作息和防晒稳住。\n\n💡 其次，选温和提亮而不是猛药。\n\n✅ 最后，坚持两周再看变化。",
        "tags": ["干货分享", "好物分享", "护肤心得", "打工人", "避坑指南"],
        "interaction": "⭐ 觉得有用先马住～评论区聊聊你踩过哪些坑？",
        "imageSuggestions": [
            "封面：大字「熬夜急救」+ 左右脸对比分屏，暖白光",
            "内页：书桌素颜对镜 3 张连拍，自然窗光",
            "结尾图：产品平铺 + 手写便签标注步骤序号",
        ],
        "theme": "把资料里的重点整理成可收藏的笔记式摘要。",
    }


def _fallback_mp() -> dict[str, Any]:
    return {
        "titles": [
            "一文读懂：资料里的核心结论",
            "深度解读：这件事你必须知道",
            "收藏这篇，下次用得上",
        ],
        "cover_hook": "一文读懂：资料里的核心结论",
        "opening_30": "如果你最近也在关注这个话题，这篇值得读完。",
        "body": "## 核心结论\n\n先把最重要的信息说清楚。\n\n## 展开说明\n\n- 要点一\n- 要点二\n\n## 小结\n\n欢迎转发给需要的朋友。",
        "tags": ["深度好文", "干货分享", "职场成长", "收藏推荐"],
        "interaction": "你觉得哪一点最有用？欢迎留言讨论。",
        "imageSuggestions": [
            "头图：16:9 横图，主标题大字 + 简洁背景",
            "文内插图：信息图或步骤示意图 1～2 张",
        ],
        "theme": "公众号长文导读",
    }


def _mp_system_prompt(opt_block: str) -> str:
    return f"""你是微信公众号资深编辑。用户会给你一份素材，请改写为适合公众号图文发布的稿件（非照抄）。

{opt_block}

结构硬性要求：
1. cover_hook + titles 数组（恰好 3 个备选标题，每个≤28字）：信息明确、适合订阅号列表点击。
2. opening_30：导读句，总字数≤30（含标点）。
3. body：正文主体，可用 Markdown（## 小标题、列表）；勿把话题与文末引导写入 body。
4. tags：5～8 个领域关键词，不带#（由系统并入正文末尾）。
5. interaction：1～2 句留言/转发引导（由系统并入正文末尾）。
6. imageSuggestions：2～4 条配图建议（头图比例、文内插图主题与构图）。

禁止：播客腔、绝对化/医疗化承诺、硬引流。

只输出一个 JSON 对象，不要 markdown 代码块。键：
cover_hook, titles, opening_30, body, interaction, tags, imageSuggestions, theme"""


def _xhs_system_prompt(opt_block: str) -> str:
    return f"""你是小红书头部 MCN 内容总监。用户会给你一份素材（可能来自对话、文章或播客整理）。
你必须**重写**为工业级小红书笔记配套文案，而不是照抄素材。

{opt_block}

结构硬性要求：
1. cover_hook + titles 数组（恰好 3 个备选标题，每个≤28字）：人群/场景 + 痛点 + 解法/情绪价值。
2. opening_30：正文开头句，总字数≤30（含标点）。
3. body 或 sections：正文主体（干货/种草结构），段间 \\n\\n；勿把话题与互动句写入 body。
4. tags：5～8 个垂类话题词，不带#（由系统并入正文末尾）。
5. interaction：1～2 句互动引导（由系统并入正文末尾）。
6. imageSuggestions：2～4 条图片制作建议（配图主题、构图、封面大字、色调/道具），供发布者拍图参考，不是封面文案本身。

禁止：Speaker 对话格式、连续照抄 18 字以上、绝对化/医疗化/硬引流用语。

只输出一个 JSON 对象，不要 markdown 代码块。键：
cover_hook, titles, opening_30, body（或 sections 数组）, interaction, tags, imageSuggestions, theme"""


def resolve_social_publish_material_from_notes(
    user_ref: str | None,
    *,
    selected_note_ids: list[str],
    notes_source_owner_user_id: str | None = None,
    use_rag: bool = True,
    rag_max_chars: int = 56_000,
    reference_rag_mode: str = "truncate",
    material_hint: str = "",
) -> str:
    """与生成文章一致：勾选笔记 + 分层 RAG / 合并参考（merge_reference_for_script）。"""
    from .reference_material import merge_reference_for_script

    nids = [str(x).strip() for x in selected_note_ids if str(x).strip()]
    if not nids:
        raise RuntimeError("material_too_short")
    mode = str(reference_rag_mode or "truncate").strip().lower()
    if mode not in ("truncate", "keyword", "full_coverage", "hybrid"):
        mode = "truncate"
    try:
        rag_cap = int(rag_max_chars)
    except (TypeError, ValueError):
        rag_cap = 56_000
    rag_cap = max(8_000, min(120_000, rag_cap))

    payload: dict[str, Any] = {
        "selected_note_ids": nids,
        "use_rag": bool(use_rag),
        "rag_max_chars": rag_cap,
        "reference_rag_mode": mode,
        "text": (material_hint or "根据勾选资料撰写自媒体发布稿").strip()[:2000],
        "script_language": "中文",
    }
    owner = str(notes_source_owner_user_id or "").strip()
    if owner:
        payload["notes_source_owner_user_id"] = owner

    merged, _meta = merge_reference_for_script(payload, "", "", user_ref=user_ref)
    raw = (merged or "").strip()
    if len(raw) < 40:
        raise RuntimeError("material_too_short")
    if len(raw) > 48_000:
        raw = raw[:48_000] + "…"
    return raw


def generate_social_publish_draft(
    material_text: str,
    *,
    platform: str,
    options: dict[str, Any] | None,
) -> dict[str, Any]:
    """platform: xiaohongshu | wechat_mp"""
    opts = options if isinstance(options, dict) else {}
    raw = (material_text or "").strip()
    if len(raw) < 40:
        raise RuntimeError("material_too_short")
    if len(raw) > 48_000:
        raw = raw[:48_000] + "…"

    opt_block = _options_prompt_block(opts, platform)

    if platform == "xiaohongshu":
        system = _xhs_system_prompt(opt_block)
        user = f"请根据下列素材重写为上述 JSON。\n\n【素材】\n{raw}"
        raw_out, trace_id = invoke_social_llm(system, user)
        try:
            data = parse_json_object(raw_out)
        except (json.JSONDecodeError, ValueError):
            data = dict(_fallback_xhs())
        try:
            return finalize_xhs_pack(data, options=opts, trace_id=trace_id)
        except RuntimeError as exc:
            if str(exc) == "compliance_failed":
                logger.warning("xhs compliance_failed, using fallback pack")
                return finalize_xhs_pack(_fallback_xhs(), options=opts, trace_id=trace_id)
            raise

    system = _mp_system_prompt(opt_block)
    user = f"请根据下列素材改写为上述 JSON。\n\n【素材】\n{raw}"
    raw_out, trace_id = invoke_social_llm(system, user)
    try:
        data = parse_json_object(raw_out)
    except (json.JSONDecodeError, ValueError):
        data = dict(_fallback_mp())
    try:
        return finalize_xhs_pack(data, options=opts, trace_id=trace_id)
    except RuntimeError as exc:
        if str(exc) == "compliance_failed":
            logger.warning("mp compliance_failed, using fallback pack")
            return finalize_xhs_pack(_fallback_mp(), options=opts, trace_id=trace_id)
        raise
