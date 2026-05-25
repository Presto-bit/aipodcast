"""知识库「发布到自媒体」：按平台与勾选项将素材改写为可复制的发布稿（固定 DeepSeek，不走平台 API）。"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from .social_viral_copy import _invoke_social_llm, _normalize_tags, _parse_json_object

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
_LENGTH_CN = {
    "short": "短文（约 300–600 字）",
    "medium": "中等（约 600–1200 字）",
    "long": "长文（约 1200 字以上）",
}
_TONE_CN = {
    "casual": "亲切口语",
    "pro": "专业克制",
    "humor": "幽默轻松",
    "motivational": "热血励志",
}


def _options_prompt_block(options: dict[str, Any], platform: str) -> str:
    intent = _INTENT_CN.get(str(options.get("intent") or "").strip(), "干货科普")
    audience = _AUDIENCE_CN.get(str(options.get("audience") or "").strip(), "普通读者")
    length = _LENGTH_CN.get(str(options.get("length") or "").strip(), "中等（约 600–1200 字）")
    tone = _TONE_CN.get(str(options.get("tone") or "").strip(), "亲切口语")
    extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}
    must = extras.get("mustInclude") if isinstance(extras.get("mustInclude"), list) else []
    avoid = extras.get("avoid") if isinstance(extras.get("avoid"), list) else []
    note = str(options.get("userNote") or extras.get("userNote") or "").strip()[:500]

    lines = [
        f"【内容目标】{intent}",
        f"【读者】{audience}",
        f"【语气】{tone}",
        f"【篇幅】{length}",
    ]
    if must:
        lines.append(f"【必须包含】{', '.join(str(x) for x in must[:8])}")
    if avoid:
        lines.append(f"【规避】{', '.join(str(x) for x in avoid[:8])}")
    if platform == "xiaohongshu":
        note_form = str(extras.get("noteForm") or "image_text").strip()
        emoji = str(extras.get("emojiLevel") or "medium").strip()
        interaction = str(extras.get("interaction") or "collect").strip()
        want_titles = extras.get("wantTitleOptions", True)
        want_tags = str(extras.get("tagsMode") or "vertical10").strip()
        want_cover = extras.get("wantCoverSuggestions", True)
        lines.append(f"【小红书形态】{'图文笔记' if note_form != 'video_caption' else '视频配文'}")
        lines.append(f"【Emoji】{emoji}")
        lines.append(f"【互动】{interaction}")
        if want_titles:
            lines.append("【标题】请输出 5 个不同类型备选标题（数组 titles）")
        if want_tags:
            lines.append("【话题】6～10 个垂类话题词（数组 tags，不带#）")
        if want_cover:
            lines.append("【封面】2～3 条首图构图与封面文案建议（数组 coverSuggestions）")
    else:
        mp_type = str(extras.get("mpArticleType") or "headline").strip()
        structure = str(extras.get("mpStructure") or "intro_sections").strip()
        want_digest = extras.get("wantDigest", True)
        cta = extras.get("mpCta") if isinstance(extras.get("mpCta"), list) else []
        lines.append(f"【公众号类型】{'头条长文' if mp_type == 'headline' else '次条短文' if mp_type == 'sub' else '快讯简报'}")
        lines.append(f"【结构】{structure}")
        if want_digest:
            lines.append("【摘要】输出 digest（≤120 字）")
        if cta:
            lines.append(f"【文末模块】{', '.join(str(x) for x in cta[:6])}")
    if note:
        lines.append(f"【用户补充】{note}")
    return "\n".join(lines)


def _fallback_xhs() -> dict[str, Any]:
    return {
        "titles": ["这篇干货我先收藏了", "3 分钟搞懂重点", "看完省你一小时弯路", "别划走，结尾有彩蛋", "亲测有用的笔记"],
        "body": "核心内容已帮你压成短段落。\n\n若显示异常，请刷新后重新生成。",
        "tags": ["成长笔记", "干货分享", "自我提升", "学习打卡", "收藏夹吃灰"],
        "interaction": "哪一条最有用？评论告诉我～",
        "coverSuggestions": ["封面大字：干货总结 + 干净书桌背景", "对比图：Before/After 两栏"],
        "theme": "把资料里的重点整理成可收藏的笔记式摘要。",
    }


def _fallback_mp() -> dict[str, Any]:
    return {
        "title": "一文读懂：资料里的核心结论",
        "digest": "把笔记本里的要点整理成可读长文，方便转发与收藏。",
        "body": "## 引言\n\n本文根据你勾选的资料整理。\n\n## 核心要点\n\n- 要点一\n- 要点二\n\n## 结语\n\n欢迎收藏，如需完整版可继续阅读相关作品。",
        "cta": "",
    }


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
        system = f"""你是小红书头部 MCN 内容总监。用户会给你一份素材（可能来自对话、文章或播客整理）。
你必须**重写**为适合小红书发布的笔记配套文案，而不是照抄素材。

{opt_block}

硬性禁止：
1. 禁止 Speaker/主持人/嘉宾轮次对话格式。
2. 禁止连续照搬素材 18 个以上相同汉字。
3. body 为 2～6 段，段间用 \\n\\n，口语化、可分点，每段不宜超过 4 行。

只输出一个 JSON 对象，不要 markdown 代码块。键：
- titles（字符串数组，5 个备选标题，每个≤28字）
- theme（40～100字价值概括，可选展示）
- body（正文）
- tags（6～10个话题词，不带#）
- interaction（一句互动引导）
- coverSuggestions（2～3条封面构图与封面文字建议）"""

        user = f"请根据下列素材重写为上述 JSON。\n\n【素材】\n{raw}"
        raw_out, trace_id = _invoke_social_llm(system, user)
        try:
            data = _parse_json_object(raw_out)
        except (json.JSONDecodeError, ValueError):
            data = dict(_fallback_xhs())
        titles = data.get("titles")
        if not isinstance(titles, list) or not titles:
            t0 = str(data.get("title") or "").strip()
            titles = [t0] if t0 else _fallback_xhs()["titles"]
        titles = [str(t).strip()[:120] for t in titles if str(t).strip()][:5]
        if not titles:
            titles = _fallback_xhs()["titles"]
        body = str(data.get("body") or "").strip().replace("\\n\\n", "\n\n").replace("\\n", "\n")
        if not body:
            body = _fallback_xhs()["body"]
        tags = _normalize_tags(data.get("tags")) or _fallback_xhs()["tags"]
        covers = data.get("coverSuggestions")
        if not isinstance(covers, list):
            covers = _fallback_xhs()["coverSuggestions"]
        covers = [str(c).strip()[:300] for c in covers if str(c).strip()][:3]
        return {
            "platform": "xiaohongshu",
            "titles": titles,
            "theme": str(data.get("theme") or "").strip()[:500],
            "body": body[:8000],
            "tags": tags,
            "interaction": str(data.get("interaction") or "欢迎评论交流～")[:300],
            "coverSuggestions": covers or _fallback_xhs()["coverSuggestions"],
            "trace_id": trace_id,
        }

    system = f"""你是微信公众号资深编辑。用户会给你一份素材，请改写为适合公众号图文发布的稿件（非照抄）。

{opt_block}

要求：
1. 使用 Markdown：## 小标题、列表、引用块（> ）均可。
2. 语气符合选项，结构清晰，避免播客口播腔。
3. 禁止 Speaker 轮次格式。

只输出一个 JSON 对象。键：
- title（≤64字）
- digest（≤120字，导语摘要）
- body（Markdown 正文，可含 ## 小节）
- cta（可选，文末引导语一段，如收听链接说明；无则空字符串）"""

    user = f"请根据下列素材改写为上述 JSON。\n\n【素材】\n{raw}"
    raw_out, trace_id = _invoke_social_llm(system, user)
    try:
        data = _parse_json_object(raw_out)
    except (json.JSONDecodeError, ValueError):
        data = dict(_fallback_mp())
    title = str(data.get("title") or "").strip()[:120] or _fallback_mp()["title"]
    digest = str(data.get("digest") or "").strip()[:120]
    body = str(data.get("body") or "").strip().replace("\\n\\n", "\n\n").replace("\\n", "\n")
    if not body:
        body = _fallback_mp()["body"]
    return {
        "platform": "wechat_mp",
        "title": title,
        "digest": digest or _fallback_mp()["digest"],
        "body": body[:12000],
        "cta": str(data.get("cta") or "").strip()[:500],
        "trace_id": trace_id,
    }
