"""知识库「发布到自媒体」：按平台与勾选项将素材改写为可复制的发布稿（固定 DeepSeek，不走平台 API）。"""
from __future__ import annotations

import json
import logging
from typing import Any

from .social_compliance import apply_compliance_to_mp_fields
from .social_llm_utils import invoke_and_parse_social_json, normalize_tags
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


def _normalize_social_options(options: dict[str, Any], platform: str) -> dict[str, Any]:
    """合并 platform；性别互斥（女+男→不限），避免矛盾画像导致模型空回。"""
    opts = dict(options)
    opts["platform"] = platform
    persona = opts.get("persona")
    if not isinstance(persona, dict):
        return opts
    genders_raw = persona.get("genders")
    if isinstance(genders_raw, list):
        gset = {str(g).strip() for g in genders_raw if str(g).strip()}
        if not gset:
            gset = {"any"}
        elif "any" in gset or ("female" in gset and "male" in gset):
            gset = {"any"}
        elif len(gset) > 1:
            gset = {next(iter(gset))}
        opts["persona"] = {**persona, "genders": list(gset)}
    return opts


def _social_llm_max_tokens(options: dict[str, Any]) -> int:
    target = _resolve_target_chars(options)
    # 中文发布稿 JSON 约 2～3 字/token，留足标题/话题/配图字段
    return max(2048, min(8192, int(target * 2.8) + 800))


def _fallback_from_material(raw: str, platform: str) -> dict[str, Any]:
    """LLM/合规失败时：用勾选资料摘录组装可编辑草稿，避免通用占位话术。"""
    excerpt = _strip_social_material_boilerplate((raw or "").strip())[:4000]
    if len(excerpt) < 40:
        return _fallback_xhs() if platform == "xiaohongshu" else _fallback_mp()
    lines = [
        ln.strip()
        for ln in excerpt.splitlines()
        if ln.strip() and not ln.strip().startswith(("【", "##", "---"))
    ]
    headline = (lines[0] if lines else excerpt)[:28] or "资料要点整理"
    core = "\n".join(lines[1:12]) if len(lines) > 1 else excerpt
    core = core[:2400].strip() or excerpt[:1200]
    if platform == "wechat_mp":
        body = (
            f"## 核心结论\n\n{core[:900]}\n\n"
            f"## 展开说明\n\n{core[900:2200] if len(core) > 900 else core}\n\n"
            "## 小结\n\n以上内容整理自你勾选的笔记本资料，可按需要增删小标题与案例。"
        )
        return {
            "titles": [
                headline,
                f"{headline[:18]}｜要点梳理" if len(headline) > 4 else "资料要点梳理",
                "收藏这篇资料整理",
            ],
            "cover_hook": headline,
            "opening_30": headline[:30],
            "body": body,
            "tags": ["深度好文", "干货分享", "知识整理", "收藏推荐", "阅读笔记"],
            "interaction": "哪一段对你最有启发？欢迎留言。",
            "imageSuggestions": [
                "头图：资料主题关键词 + 简洁背景",
                "文内：摘录中的关键数据或步骤做成信息图",
            ],
            "theme": "基于勾选资料整理的公众号稿",
        }
    body = f"📌 先说结论\n\n{core[:700]}\n\n💡 展开\n\n{core[700:1600] if len(core) > 700 else ''}".strip()
    return {
        "titles": [
            headline,
            f"{headline[:16]}｜真实整理" if len(headline) > 4 else "资料笔记整理",
            "先收藏这篇干货",
        ],
        "cover_hook": headline,
        "opening_30": headline[:30],
        "body": body or excerpt[:1200],
        "tags": ["干货分享", "真实体验", "知识整理", "避坑指南", "收藏推荐"],
        "interaction": "你觉得哪一点最有用？评论区聊聊～",
        "imageSuggestions": [
            "封面：资料主题关键词 + 大字标题",
            "内页：摘录要点做成清单图",
        ],
        "theme": "基于勾选资料整理的小红书稿",
    }


def _trim_material_for_llm(raw: str) -> str:
    text = (raw or "").strip()
    cap = _LLM_MATERIAL_MAX_CHARS
    if len(text) <= cap:
        return text
    half = cap // 2
    return f"{text[:half]}\n\n…（中间省略，完整资料已用于摘录回退）…\n\n{text[-half:]}"


def _finalize_draft_pack(
    data: dict[str, Any],
    *,
    options: dict[str, Any],
    platform: str,
    material_text: str,
    trace_id: Any = None,
) -> dict[str, Any]:
    static = _fallback_xhs() if platform == "xiaohongshu" else _fallback_mp()
    for cand in (data, _fallback_from_material(material_text, platform), static):
        try:
            return finalize_xhs_pack(
                cand,
                options=options,
                trace_id=trace_id,
                compliance_max_llm_passes=0,
            )
        except Exception as exc:
            logger.warning(
                "social_publish finalize attempt failed platform=%s: %s",
                platform,
                exc,
            )
    raise RuntimeError("social_publish_pack_failed")


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


_MERGE_PLACEHOLDER = "请介绍 AI Native 应用架构"
# 送入 LLM 的素材上限（字符）；合并参考可达 48k，过长易触发上游 context/超时错误
_LLM_MATERIAL_MAX_CHARS = 18_000

# RAG/合并参考时的系统说明块，不应进入发布稿正文或 fallback 摘录
_SOCIAL_MATERIAL_BOILERPLATE_MARKERS = (
    "【勾选笔记·摘要与向量检索】",
    "【来源清单】",
    "【来源数量锁定】",
    "## 异步摘要",
    "与任务相关的原文摘录",
    "向量检索，勾选笔记范围内",
)


def _strip_social_material_boilerplate(text: str) -> str:
    """去掉分层 RAG 说明与来源锁定提示，保留笔记正文与摘录。"""
    s = (text or "").strip()
    if not s:
        return ""
    if "【勾选笔记·摘要与向量检索】" in s:
        parts = s.split("---", 1)
        if len(parts) > 1:
            s = parts[1].strip()
    lines: list[str] = []
    skip_block = False
    for ln in s.splitlines():
        t = ln.strip()
        if any(m in t for m in _SOCIAL_MATERIAL_BOILERPLATE_MARKERS):
            skip_block = True
            continue
        if skip_block and t.startswith("##"):
            skip_block = False
        if skip_block and not t:
            continue
        if t.startswith("【笔记：") or (t and not t.startswith("【") and not t.startswith("## 异步")):
            skip_block = False
        if skip_block:
            continue
        if t.startswith("## 异步摘要"):
            continue
        lines.append(ln)
    out = "\n".join(lines).strip()
    return out if len(out) >= 40 else s


def _merge_reference_for_social(
    payload: dict[str, Any],
    user_ref: str | None,
) -> tuple[str, dict[str, Any]]:
    from .reference_material import merge_reference_for_script

    return merge_reference_for_script(payload, "", "", user_ref=user_ref)


def _fallback_note_bodies_for_social(
    user_ref: str | None,
    note_ids: list[str],
    *,
    notes_source_owner_user_id: str | None = None,
) -> str:
    """merge 未命中笔记时，按生成文章同款逻辑直接加载笔记正文。"""
    from .reference_material import load_note_text_for_script

    owner = str(notes_source_owner_user_id or "").strip() or None
    parts: list[str] = []
    for nid in note_ids[:24]:
        body, title = load_note_text_for_script(
            nid,
            user_ref=user_ref,
            project_owner_user_uuid=owner,
        )
        text = (body or "").strip()
        if not text:
            continue
        parts.append(f"【笔记：{title}】\n{text[:12_000]}")
    return "\n\n".join(parts).strip()


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
    """优先直读勾选笔记正文；仅在正文不足时再合并参考（可选 RAG）。"""
    nids = [str(x).strip() for x in selected_note_ids if str(x).strip()]
    if not nids:
        raise RuntimeError("material_too_short")
    owner = str(notes_source_owner_user_id or "").strip() or None
    bodies = _fallback_note_bodies_for_social(user_ref, nids, notes_source_owner_user_id=owner)
    bodies = _strip_social_material_boilerplate(bodies)
    if len(bodies) >= 200:
        raw = bodies
        if len(raw) > 48_000:
            raw = raw[:48_000] + "…"
        return raw

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
    if owner:
        payload["notes_source_owner_user_id"] = owner

    meta: dict[str, Any] = {}
    merged = ""
    try:
        merged, meta = _merge_reference_for_social(payload, user_ref)
    except Exception:
        logger.exception("social_publish: merge_reference_for_script failed note_count=%s", len(nids))
        merged = ""

    notes_loaded = int(meta.get("notes_loaded") or 0)
    raw = _strip_social_material_boilerplate((merged or "").strip())
    if notes_loaded < 1 or len(raw) < 40 or raw == _MERGE_PLACEHOLDER:
        if bodies:
            raw = bodies
    if len(raw) < 40:
        raise RuntimeError("notes_material_empty")
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
    opts = _normalize_social_options(options if isinstance(options, dict) else {}, platform)
    raw = (material_text or "").strip()
    if len(raw) < 40:
        raise RuntimeError("material_too_short")
    if len(raw) > 48_000:
        raw = raw[:48_000] + "…"

    opt_block = _options_prompt_block(opts, platform)
    max_tokens = _social_llm_max_tokens(opts)
    material_rule = (
        "硬性要求：正文必须引用素材中的具体事实、数据、步骤或观点，禁止输出与素材无关的通用模板"
        "（如「要点一/要点二」「先把最重要的信息说清楚」等空泛占位）。"
    )
    llm_material = _trim_material_for_llm(_strip_social_material_boilerplate(raw))

    if platform == "xiaohongshu":
        system = _xhs_system_prompt(opt_block)
        user = f"{material_rule}\n\n请根据下列素材重写为上述 JSON。\n\n【素材】\n{llm_material}"
    else:
        system = _mp_system_prompt(opt_block)
        user = f"{material_rule}\n\n请根据下列素材改写为上述 JSON。\n\n【素材】\n{llm_material}"

    data, trace_id = invoke_and_parse_social_json(system, user, max_tokens=max_tokens)
    if not data:
        logger.warning("social_publish llm unavailable or invalid json platform=%s", platform)
        data = _fallback_from_material(raw, platform)
        trace_id = None

    return _finalize_draft_pack(
        data,
        options=opts,
        platform=platform,
        material_text=raw,
        trace_id=trace_id,
    )
