"""小红书工业级结构化文案：用户定位、黄金结构、组装与标签控制。"""
from __future__ import annotations

import re
from typing import Any

from .social_compliance import (
    apply_compliance_to_xhs_fields,
    xhs_fields_from_pack,
    xhs_pack_from_compliant_fields,
)
from .social_llm_utils import normalize_tags

_PERSONA_CN = {
    "ingredient": "成分党（看配方、比浓度、理性避雷）",
    "refined_mom": "精致妈妈（育儿+自我、安全、省时）",
    "office_worker": "打工人（通勤熬夜、省钱省时、共鸣）",
    "student": "学生党（预算紧、宿舍场景、真实）",
    "fitness": "健身减脂党（热量、自律、结果）",
    "pet_owner": "铲屎官（萌宠健康、经验分享）",
    "home_renovator": "家装党（收纳颜值、实用清单）",
    "beauty_lover": "爱美党（护肤彩妆、变美攻略）",
    "night_owl": "熬夜党（作息乱、急救修护、疲惫肌）",
    "career_starter": "职场新人（入门、性价比、避坑）",
    "traveler": "旅行党（出行清单、轻便好物、打卡）",
    "foodie": "美食探店（好吃好看、城市探店）",
    "digital_geek": "数码党（参数对比、效率工具）",
    "gen_z": "Z 世代（玩梗、真实、社交货币）",
    "sensitive_skin": "敏感肌（温和、修护、无刺激）",
    "wedding_prep": "备婚族（仪式感、清单、颜值管理）",
    "mom_baby": "宝妈（育儿好物、安全省心）",
    "male_grooming": "男士理容（清爽、简单步骤、效率）",
    "renter": "租房党（小空间、收纳、平价改造）",
    "silver_gen": "银发族（实用、清晰步骤、关怀语气）",
    "custom": "自定义人群",
}
_ANXIETY_CN = {
    "waste_money": "怕踩雷浪费钱",
    "harm": "怕伤皮肤/身体",
    "no_time": "没时间",
    "info_overload": "信息过载不知信谁",
    "appearance": "颜值/状态焦虑",
    "social": "社交尴尬",
    "uncertain": "效果不确定",
}
_SKELETON_CN = {
    "dry_goods": "干货总-分-总（首先/其次/最后，短句分点）",
    "story_seed": "故事种草（场景→问题→转折→效果对比）",
    "checklist": "清单体（①②③，每点一行价值）",
}
_HOOK_CN = {
    "pain": "痛点型封面钩子",
    "number": "数字型",
    "contrast": "反差型",
    "emotion": "情绪价值型",
}
_OPENING_CN = {
    "pain_question": "直击痛点问句（你是不是也…）",
    "conclusion": "结论先行（别再盲目…）",
    "scene": "场景代入",
}


def _resolve_crowd_labels(persona: dict[str, Any]) -> list[str]:
    labels_raw = persona.get("crowdLabels")
    if isinstance(labels_raw, list) and labels_raw:
        return [str(x).strip() for x in labels_raw if str(x).strip()][:4]
    crowds = persona.get("crowds")
    if not isinstance(crowds, list) or not crowds:
        leg = str(persona.get("crowd") or "").strip()
        if leg:
            crowds = [leg]
        else:
            return []
    out: list[str] = []
    custom_note = str(persona.get("crowdCustom") or "").strip()
    for c in crowds:
        cid = str(c).strip()
        if not cid:
            continue
        if cid == "custom" and custom_note:
            out.append(custom_note[:40])
        elif cid == "custom":
            out.append("自定义人群")
        else:
            out.append(_PERSONA_CN.get(cid, cid))
    return out[:4]


def build_persona_prompt_block(options: dict[str, Any]) -> str:
    persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
    anxieties = persona.get("anxieties") if isinstance(persona.get("anxieties"), list) else []
    keywords = persona.get("keywords") if isinstance(persona.get("keywords"), list) else []
    crowd_labels = _resolve_crowd_labels(persona)
    anx_cn = [_ANXIETY_CN.get(str(a).strip(), str(a)) for a in anxieties if str(a).strip()][:3]
    kw = [str(k).strip() for k in keywords if str(k).strip()][:12]
    lines = ["【用户定位】"]
    if crowd_labels:
        lines.append(f"目标人群（可多重心智，须融合表达）：{'、'.join(crowd_labels)}")
    else:
        lines.append("目标人群：泛大众")
    if anx_cn:
        lines.append(f"核心焦虑：{'、'.join(anx_cn)}")
    if kw:
        lines.append(f"文案关键词（须自然融入标题与开头）：{'、'.join(kw)}")
    extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}
    sk = _SKELETON_CN.get(str(extras.get("bodySkeleton") or "dry_goods"), _SKELETON_CN["dry_goods"])
    hook = _HOOK_CN.get(str(extras.get("coverHookStyle") or "pain"), "痛点型")
    op = _OPENING_CN.get(str(extras.get("openingMode") or "pain_question"), "痛点问句")
    lines.append(f"封面钩子风格：{hook}（公式：人群/场景+痛点+解法/情绪价值）")
    lines.append(f"开头模式：{op}（opening_30 总字数≤30，含标点）")
    lines.append(f"正文骨架：{sk}")
    cta = extras.get("ctaTypes") if isinstance(extras.get("ctaTypes"), list) else []
    if cta:
        lines.append(f"结尾CTA：{', '.join(str(x) for x in cta[:4])}")
    emoji = str(extras.get("emojiLevel") or "medium")
    if emoji == "none":
        lines.append("Emoji：极少，不用作段首锚点")
    elif emoji == "rich":
        lines.append("Emoji：段首用 📌💡🚨✅ 作视觉锚点，全文不超过 8 个")
    else:
        lines.append("Emoji：段首适度 📌💡，全文不超过 6 个")
    tag_mode = str(extras.get("tagsMode") or "balanced")
    if tag_mode == "none":
        lines.append("话题标签：不输出 tags 或输出空数组")
    else:
        lines.append("话题标签：5～8 个，垂类+场景词，不带#")
    lines.append(
        "合规：禁止绝对化（第一/顶级/最好）、医疗化承诺、硬引流（微信/私信领取/外链）；"
        "输出前自检并改写。"
    )
    return "\n".join(lines)


def _clamp_opening_30(text: str) -> str:
    t = re.sub(r"\s+", " ", str(text or "").strip())
    if len(t) <= 30:
        return t
    return t[:30]


def _parse_cta_blocks(data: dict[str, Any], fallback_interaction: str) -> str:
    parts: list[str] = []
    for key, prefix in (
        ("cta_interact", "💬 "),
        ("cta_save", "⭐ "),
        ("cta_convert", "📌 "),
    ):
        v = str(data.get(key) or "").strip()
        if v:
            parts.append(prefix + v)
    if parts:
        return "\n\n".join(parts)
    return str(fallback_interaction or "").strip()


def normalize_xhs_llm_data(data: dict[str, Any]) -> dict[str, Any]:
    """将模型 JSON 规范为内部结构。"""
    titles_raw = data.get("titles")
    titles: list[str] = []
    if isinstance(titles_raw, list):
        titles = [str(t).strip()[:28] for t in titles_raw if str(t).strip()]
    cover_hook = str(data.get("cover_hook") or data.get("coverHook") or "").strip()
    if cover_hook and cover_hook not in titles:
        titles = [cover_hook[:28], *titles]
    t0 = str(data.get("title") or "").strip()
    if t0 and t0 not in titles:
        titles = [t0[:28], *titles]
    if not titles:
        titles = ["这篇干货我先收藏了"]

    opening = _clamp_opening_30(str(data.get("opening_30") or data.get("opening") or ""))
    if not opening:
        body_start = str(data.get("body") or "").strip()
        opening = _clamp_opening_30(body_start.split("\n")[0] if body_start else "你是不是也有这种困扰？")

    sections = data.get("sections")
    body_main = str(data.get("body") or "").strip()
    if isinstance(sections, list) and sections:
        sec_text = "\n\n".join(str(s).strip() for s in sections if str(s).strip())
        if sec_text:
            body_main = sec_text
    body_main = body_main.replace("\\n\\n", "\n\n").replace("\\n", "\n")

    interaction = _parse_cta_blocks(data, str(data.get("interaction") or ""))
    if not interaction:
        interaction = "觉得有用先马住，评论区聊聊你的看法～"

    tags = normalize_tags(data.get("tags"))[:8]
    if len(tags) < 5 and tags:
        pass
    elif len(tags) > 8:
        tags = tags[:8]

    covers = data.get("coverSuggestions") or data.get("cover_suggestions")
    cover_list: list[str] = []
    if isinstance(covers, list):
        cover_list = [str(c).strip()[:300] for c in covers if str(c).strip()][:3]

    theme = str(data.get("theme") or "").strip()[:500]
    return {
        "titles": titles[:5],
        "opening_30": opening,
        "body_main": body_main[:7500],
        "interaction": interaction[:500],
        "tags": tags,
        "coverSuggestions": cover_list,
        "theme": theme,
    }


def finalize_xhs_pack(
    data: dict[str, Any],
    *,
    options: dict[str, Any] | None = None,
    trace_id: Any = None,
) -> dict[str, Any]:
    """结构化数据 → 合规终稿 → 对外 pack（含 compliance）。"""
    norm = normalize_xhs_llm_data(data)
    _ = options

    fields = xhs_fields_from_pack(
        titles=norm["titles"],
        opening_30=norm["opening_30"],
        body=norm["body_main"],
        interaction=norm["interaction"],
        tags=norm["tags"],
        cover_suggestions=norm["coverSuggestions"],
    )
    compliant_fields, compliance = apply_compliance_to_xhs_fields(fields)

    tags_out = [compliant_fields[k] for k in sorted(compliant_fields) if k.startswith("tag_") and compliant_fields[k].strip()]
    while len(tags_out) < 5:
        for filler in ("好物分享", "干货分享", "生活记录", "真实体验", "避坑指南"):
            if filler not in tags_out:
                tags_out.append(filler)
            if len(tags_out) >= 5:
                break
        else:
            break
    tags_out = tags_out[:8]
    for i in range(8):
        key = f"tag_{i}"
        compliant_fields[key] = tags_out[i] if i < len(tags_out) else ""

    titles_out = [compliant_fields[k] for k in sorted(compliant_fields) if k.startswith("title_") and compliant_fields[k].strip()]
    if not titles_out:
        for i, t in enumerate(norm["titles"][:5]):
            compliant_fields[f"title_{i}"] = t

    return xhs_pack_from_compliant_fields(
        compliant_fields,
        compliance=compliance,
        theme=norm["theme"],
        trace_id=trace_id,
    )
