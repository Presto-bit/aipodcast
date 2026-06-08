"""知识库「发布到自媒体」：按平台与勾选项将素材改写为可复制的发布稿（固定 DeepSeek，不走平台 API）。"""
from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from .social_compliance import apply_compliance_to_mp_fields
from .social_llm_utils import invoke_and_parse_social_json, normalize_tags
from .social_xhs import build_persona_prompt_block, finalize_xhs_pack

logger = logging.getLogger(__name__)

SOCIAL_PUBLISH_MATERIAL_MIN_NOTES = 40
SOCIAL_PUBLISH_MATERIAL_MIN_COMPOSER = 15
# generate 入口下限（笔记路径在 resolve 阶段已保证 ≥40）
SOCIAL_PUBLISH_MATERIAL_MIN_LLM = SOCIAL_PUBLISH_MATERIAL_MIN_COMPOSER


def _material_min_chars(source_type: str | None) -> int:
    if str(source_type or "").strip() == "composer_prompt":
        return SOCIAL_PUBLISH_MATERIAL_MIN_COMPOSER
    return SOCIAL_PUBLISH_MATERIAL_MIN_NOTES

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


_MP_GENERIC_MARKERS = (
    "先把最重要的信息说清楚",
    "要点一",
    "要点二",
    "欢迎转发给需要的朋友",
    "如果你最近也在关注这个话题，这篇值得读完",
)

_XHS_GENERIC_MARKERS = (
    "📌 先说结论",
    "💡 其次，选温和提亮",
    "先把作息和防晒稳住",
    "你是不是也一到下午就脸垮",
    "打工人熬夜党！百元搞定暗沉",
)


def _is_generic_social_placeholder(data: dict[str, Any], platform: str) -> bool:
    """识别 LLM/静态回退的通用占位稿，避免当作成稿返回。"""
    if not isinstance(data, dict):
        return True
    body = str(data.get("body") or "").strip()
    opening = str(data.get("opening_30") or data.get("opening") or "").strip()
    if not body:
        return True
    static = _fallback_mp() if platform == "wechat_mp" else _fallback_xhs()
    static_body = str(static.get("body") or "").strip()
    if body == static_body:
        return True
    if platform == "wechat_mp":
        marker_hits = sum(1 for m in _MP_GENERIC_MARKERS if m in f"{opening}\n{body}")
        if marker_hits >= 3:
            return True
        if "要点一" in body and "要点二" in body and "先把最重要的信息说清楚" in body:
            return True
    else:
        marker_hits = sum(1 for m in _XHS_GENERIC_MARKERS if m in f"{opening}\n{body}")
        if marker_hits >= 2:
            return True
        if "📌 先说结论" in body and "💡" in body:
            return True
    return False


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
    stripped = (raw or "").strip()
    excerpt = _strip_social_material_boilerplate(stripped)[:4000]
    if len(excerpt) < 40:
        excerpt = stripped[:4000]
    if len(excerpt) < 40:
        return _fallback_xhs() if platform == "xiaohongshu" else _fallback_mp()
    lines = [
        ln.strip()
        for ln in excerpt.splitlines()
        if ln.strip() and not ln.strip().startswith(("【", "##", "---"))
    ]
    headline = (lines[0] if lines else excerpt)[:20] or "资料要点整理"
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
    body = (
        "\n\n".join(lines[1:10]).strip()
        if len(lines) > 1
        else core[:1600].strip()
    )
    if not body:
        body = core[:1600].strip() or excerpt[:1200]
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
    material_fb = _fallback_from_material(material_text, platform)
    candidates: list[dict[str, Any]] = []
    if isinstance(data, dict) and data and not _is_generic_social_placeholder(data, platform):
        candidates.append(data)
    candidates.append(material_fb)
    if len((material_text or "").strip()) < 40:
        static = _fallback_xhs() if platform == "xiaohongshu" else _fallback_mp()
        candidates.append(static)
    for cand in candidates:
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
    if platform == "xiaohongshu":
        excerpt = (material_text or "").strip()[:1200] or "基于创作任务整理的笔记"
        hook = excerpt[:20] or "本篇干货"
        rescue = {
            "cover_hook": hook,
            "titles": [hook, (excerpt[20:38] or "备选标题")[:20], "收藏备用"],
            "opening_30": excerpt[:30] or "这篇值得你花两分钟看完",
            "body": excerpt[:3500],
            "tags": ["干货分享", "真实体验", "避坑指南", "收藏推荐", "生活记录"],
            "interaction": "觉得有用吗？评论区聊聊～",
            "imageSuggestions": ["封面：标题大字", "内页：清单要点"],
            "theme": "创作任务稿",
        }
        try:
            return finalize_xhs_pack(
                rescue,
                options=options,
                trace_id=trace_id,
                compliance_max_llm_passes=0,
            )
        except Exception as exc:
            logger.warning("social_publish rescue pack failed: %s", exc)
    raise RuntimeError("social_publish_pack_failed")


def _mp_system_prompt(opt_block: str) -> str:
    return f"""你是微信公众号资深编辑。用户会给你一份素材，请改写为适合公众号图文发布的稿件（非照抄）。

{opt_block}

结构硬性要求：
1. cover_hook + titles 数组（恰好 3 个备选标题，每个≤20字）：信息明确、适合订阅号列表点击。
2. opening_30：导读句，总字数≤30（含标点）。
3. body：正文主体，可用 Markdown（## 小标题、列表）；勿把话题与文末引导写入 body。
4. tags：5～8 个领域关键词，不带#（由系统并入正文末尾）。
5. interaction：1～2 句留言/转发引导（由系统并入正文末尾）。
6. imageSuggestions：2～4 条配图建议，每项为简短字符串（如「头图：漫画风格…」），不要用嵌套 JSON 对象。

禁止：播客腔、绝对化/医疗化承诺、硬引流。

只输出一个 JSON 对象，不要 markdown 代码块。键：
cover_hook, titles, opening_30, body, interaction, tags, imageSuggestions, theme"""


def _xhs_system_prompt(opt_block: str) -> str:
    return f"""你是小红书头部 MCN 内容总监。用户会给你一份素材（可能来自对话、文章或播客整理）。
你必须**重写**为工业级小红书笔记配套文案，而不是照抄素材。

{opt_block}

结构硬性要求：
1. cover_hook + titles 数组（恰好 3 个备选标题，每个≤20字）：人群/场景 + 痛点 + 解法/情绪价值。
2. opening_30：正文开头句，总字数≤30（含标点）。
3. bodies 数组（恰好 3 个字符串）：与 titles 顺序一一对应，分别为痛点向/好奇向/数字向的完整正文变体，写法与角度须明显不同；勿把话题与互动句写入 bodies。
   若无 bodies 则可用 body 或 sections；sections 每项必须是 JSON 对象 {{"heading":"小标题","content":"段落"}}，禁止 Python 字典字面量字符串。
4. body（可选）：与 bodies[0] 一致的主正文；段内用句号衔接，避免连续空行。
5. tags：5～8 个垂类话题词，不带#（由系统并入正文末尾）。
6. interactions 数组（恰好 3 个字符串）：与 titles/bodies 顺序一一对应，各 1～2 句互动引导（由系统并入正文末尾）；若无则用 interaction 单字段。
7. imageSuggestions：2～4 条图片制作建议，每项为简短字符串（如「封面：大字标题+实拍」），不要用嵌套 JSON 对象。

禁止：Speaker 对话格式、连续照抄 18 字以上、绝对化/医疗化/硬引流用语。

只输出一个 JSON 对象，不要 markdown 代码块。键：
cover_hook, titles, opening_30, bodies（3 个正文变体）, body（或 sections 数组）, interactions（3 个互动句）, interaction, tags, imageSuggestions, theme"""


_MERGE_PLACEHOLDER = "请介绍 AI Native 应用架构"
# 送入 LLM 的素材上限（字符）；合并参考可达 56k，过长易触发上游 context/超时错误
_LLM_MATERIAL_MAX_CHARS = 24_000

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
    """合并勾选资料：use_rag 时与生成文章同源 merge_reference_for_script；否则可直读笔记正文。"""
    nids = [str(x).strip() for x in selected_note_ids if str(x).strip()]
    if not nids:
        raise RuntimeError("material_too_short")
    owner = str(notes_source_owner_user_id or "").strip() or None
    bodies = _fallback_note_bodies_for_social(user_ref, nids, notes_source_owner_user_id=owner)
    bodies = _strip_social_material_boilerplate(bodies)
    use_rag_merge = bool(use_rag)
    if not use_rag_merge and len(bodies) >= 200:
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

    hint = (material_hint or "根据勾选资料撰写自媒体发布稿").strip()[:2000]
    payload: dict[str, Any] = {
        "selected_note_ids": nids,
        "use_rag": use_rag_merge,
        "rag_max_chars": rag_cap,
        "reference_rag_mode": mode,
        "text": hint,
        "script_language": "中文",
        "script_style": "自媒体发布稿，信息密度高、可发布",
        "program_name": "自媒体发布",
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


def resolve_social_publish_material(
    user_ref: str | None,
    *,
    selected_note_ids: list[str] | None = None,
    material_text: str | None = None,
    notes_source_owner_user_id: str | None = None,
    use_rag: bool = True,
    rag_max_chars: int = 56_000,
    reference_rag_mode: str = "truncate",
    material_hint: str = "",
    source_type: str | None = None,
) -> str:
    """合并素材：有勾选资料走 RAG；否则用 material_text（如首页 Composer 用户输入 + 通识回答）。"""
    nids = [str(x).strip() for x in (selected_note_ids or []) if str(x).strip()]
    if nids:
        return resolve_social_publish_material_from_notes(
            user_ref,
            selected_note_ids=nids,
            notes_source_owner_user_id=notes_source_owner_user_id,
            use_rag=use_rag,
            rag_max_chars=rag_max_chars,
            reference_rag_mode=reference_rag_mode,
            material_hint=material_hint,
        )
    raw = _strip_social_material_boilerplate((material_text or "").strip())
    min_len = _material_min_chars(source_type)
    if len(raw) < min_len:
        raise RuntimeError("material_too_short")
    if len(raw) > 48_000:
        raw = raw[:48_000] + "…"
    return raw


def generate_social_publish_draft(
    material_text: str,
    *,
    platform: str,
    options: dict[str, Any] | None,
    on_stream_delta: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """platform: xiaohongshu | wechat_mp"""
    opts = _normalize_social_options(options if isinstance(options, dict) else {}, platform)
    raw = (material_text or "").strip()
    if len(raw) < SOCIAL_PUBLISH_MATERIAL_MIN_LLM:
        raise RuntimeError("material_too_short")
    if len(raw) > 48_000:
        raw = raw[:48_000] + "…"

    opt_block = _options_prompt_block(opts, platform)
    max_tokens = _social_llm_max_tokens(opts)
    material_rule = (
        "硬性要求：正文必须引用素材中的具体事实、数据、步骤或观点，禁止输出与素材无关的通用模板"
        "（如「要点一/要点二」「先把最重要的信息说清楚」「📌先说结论/💡展开」等空泛占位）。"
    )
    llm_material = _trim_material_for_llm(_strip_social_material_boilerplate(raw))
    is_composer = str(opts.get("source_type") or "").strip() == "composer_prompt"

    if platform == "xiaohongshu":
        system = _xhs_system_prompt(opt_block)
        if is_composer:
            user = (
                f"{material_rule}\n\n"
                "你是首页 Composer 红书搭子。用户已在【创作任务】中描述具体产品/主题/场景，"
                "须围绕该任务写可发布的小红书笔记 JSON，正文像真人种草而非填空模板。\n"
                "禁止：📌先说结论/💡展开/✅最后 分段、要点一二三、与任务无关的通用案例、复述【创作任务】标签。\n"
                "正文用自然段表达，可带 1～2 个小标题，每段须含任务相关的具体信息。\n"
                "正文每段不超过 80 字，段间 \\n\\n；清单用 · 或 ①②③ 分行，禁止整屏大段。\n\n"
                f"请根据下列素材输出 JSON。\n\n【素材】\n{llm_material}"
            )
        else:
            user = f"{material_rule}\n\n请根据下列素材重写为上述 JSON。\n\n【素材】\n{llm_material}"
    else:
        system = _mp_system_prompt(opt_block)
        user = f"{material_rule}\n\n请根据下列素材改写为上述 JSON。\n\n【素材】\n{llm_material}"

    data, trace_id = invoke_and_parse_social_json(
        system,
        user,
        max_tokens=max_tokens,
        on_stream_delta=on_stream_delta,
    )
    if not data or _is_generic_social_placeholder(data, platform):
        if data and _is_generic_social_placeholder(data, platform):
            logger.warning("social_publish llm returned generic placeholder platform=%s", platform)
        else:
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
