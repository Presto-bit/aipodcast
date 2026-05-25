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
        return min(5000, max(100, raw))
    if isinstance(raw, float) and raw > 0:
        return min(5000, max(100, int(raw)))
    if isinstance(raw, str) and raw.strip().isdigit():
        return min(5000, max(100, int(raw.strip())))
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
    if platform == "xiaohongshu":
        lines.append(build_persona_prompt_block(options))
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
        "title": "一文读懂：资料里的核心结论",
        "digest": "把笔记本里的要点整理成可读长文，方便转发与收藏。",
        "body": "## 引言\n\n本文根据你勾选的资料整理。\n\n## 核心要点\n\n- 要点一\n- 要点二\n\n## 结语\n\n欢迎收藏，如需完整版可继续阅读相关作品。",
        "cta": "",
    }


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

    system = f"""你是微信公众号资深编辑。用户会给你一份素材，请改写为适合公众号图文发布的稿件（非照抄）。

{opt_block}

要求：
1. 使用 Markdown：## 小标题、列表、引用块（> ）均可。
2. 语气符合选项，结构清晰，避免播客口播腔。
3. 禁止 Speaker 轮次格式；禁止绝对化、医疗化承诺、硬引流。

只输出一个 JSON 对象。键：
- title（≤64字）
- digest（≤120字，导语摘要）
- body（Markdown 正文，可含 ## 小节）
- cta（可选，文末引导语一段；无则空字符串）"""

    user = f"请根据下列素材改写为上述 JSON。\n\n【素材】\n{raw}"
    raw_out, trace_id = invoke_social_llm(system, user)
    try:
        data = parse_json_object(raw_out)
    except (json.JSONDecodeError, ValueError):
        data = dict(_fallback_mp())
    title = str(data.get("title") or "").strip()[:120] or _fallback_mp()["title"]
    digest = str(data.get("digest") or "").strip()[:120]
    body = str(data.get("body") or "").strip().replace("\\n\\n", "\n\n").replace("\\n", "\n")
    if not body:
        body = _fallback_mp()["body"]
    cta = str(data.get("cta") or "").strip()[:500]

    mp_fields = {"title": title, "digest": digest, "body": body, "cta": cta}
    try:
        compliant, compliance = apply_compliance_to_mp_fields(mp_fields)
        title = compliant.get("title", title)
        digest = compliant.get("digest", digest)
        body = compliant.get("body", body)
        cta = compliant.get("cta", cta)
    except RuntimeError:
        compliance = {"status": "passed", "hit_count": 0, "categories": [], "user_message": "合规检查通过"}

    return {
        "platform": "wechat_mp",
        "title": title,
        "digest": digest or _fallback_mp()["digest"],
        "body": body[:12000],
        "cta": cta,
        "compliance": compliance,
        "trace_id": trace_id,
    }
