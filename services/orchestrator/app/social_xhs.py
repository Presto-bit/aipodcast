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


_GENDER_CN = {
    "female": "女性为主",
    "male": "男性为主",
    "any": "性别不限",
}
_AGE_CN = {
    "18_24": "18–24 岁",
    "25_34": "25–34 岁",
    "35_44": "35–44 岁",
    "45_plus": "45 岁及以上",
    "all_ages": "全年龄段",
}
_REGION_CN = {
    "tier1": "一线城市（北上广深等）",
    "tier2": "二线城市",
    "tier3_down": "三四线及以下城市",
    "any": "地域不限",
}
_WRITER_VOICE_CN = {
    "bestie_brother": "贴心闺蜜/兄弟型：口语亲切、像朋友安利、适度 emoji，不说教",
    "expert_scholar": "行业专家/斜杠学霸：有观点、有结构、引用经验与对比，可信克制",
    "growth_companion": "养成系/真实陪伴：记录变化、真诚克制、过程感与陪伴感",
    "sharp_truth": "毒舌人间清醒：直给结论、适度犀利、反套路、不说空话",
    "official_account": "机构/品牌官方：稳重可信、信息清晰、少口语化夸张",
    "insight_column": "深度洞察专栏：有论据、有结构、适合公众号长文阅读",
    "warm_story": "温暖人文叙事：故事感与共情，适合订阅用户深度阅读",
    "practical_guide": "实用攻略体：步骤清晰、小标题分节、收藏转发导向",
}
_INTEREST_CN_MP = {
    "biz_finance": "财经商业",
    "edu_exam": "教育考试",
    "health": "健康养生",
    "lifestyle": "生活方式",
    "news_current": "时政资讯",
    "humanities": "人文历史",
    "law": "法律普法",
    "auto": "汽车出行",
    "real_estate": "房产置业",
    "agri": "三农",
}
_OCC_CN_MP = {
    "civil_servant": "体制内/事业单位",
    "teacher": "教师/科研工作者",
    "professional": "医生/律师等专业人士",
    "retiree": "退休群体",
}
_EMOJI_STYLE_CN = {
    "section_anchor": "段首锚点（📌💡🚨 等，每段最多 1 个）",
    "list_markers": "清单条目前缀（✅☑️❌）",
    "mood": "情绪点缀（🥹😭🔥✨ 适度穿插）",
    "title_sparkle": "标题/封面钩子可用 ✨🔥 吸睛",
    "none": "正文与标题尽量不用 emoji",
}
_INTEREST_CN_XHS = {
    "beauty": "美妆护肤",
    "fashion": "穿搭",
    "food": "美食",
    "travel": "旅行",
    "fitness": "健身运动",
    "home": "家居生活",
    "tech": "数码科技",
    "career": "职场成长",
    "study": "读书学习",
    "parenting": "母婴育儿",
    "pets": "萌宠",
    "photo": "摄影",
    "coffee": "咖啡探店",
    "entertainment": "影视娱乐",
    "music": "音乐",
    "gaming": "游戏",
    "finance": "理财",
    "emotion": "情感",
    "diy": "手工 DIY",
    "outdoor": "户外",
}
_OCC_CN = {
    "office_worker": "上班族/职场白领",
    "student": "学生",
    "parent": "宝妈/宝爸",
    "freelancer": "自由职业",
    "entrepreneur": "创业者",
    "creator": "自媒体/内容创作者",
}


def _persona_id_list(persona: dict[str, Any], plural: str, singular: str) -> list[str]:
    raw = persona.get(plural)
    if isinstance(raw, list) and raw:
        return [str(x).strip() for x in raw if str(x).strip()]
    leg = str(persona.get(singular) or "").strip()
    return [leg] if leg else []


def _labels_from_map(ids: list[str], mapping: dict[str, str], fallback: str) -> str:
    if not ids:
        return fallback
    return "、".join(mapping.get(i, i) for i in ids[:6])


def _interest_map(platform: str) -> dict[str, str]:
    m = dict(_INTEREST_CN_XHS)
    if platform == "wechat_mp":
        m.update(_INTEREST_CN_MP)
    return m


def _occ_map(platform: str) -> dict[str, str]:
    m = dict(_OCC_CN)
    if platform == "wechat_mp":
        m.update(_OCC_CN_MP)
    return m


def _resolve_occupation_labels(persona: dict[str, Any], platform: str = "xiaohongshu") -> str:
    leg = persona.get("occupationLabels")
    if isinstance(leg, list) and leg:
        return "、".join(str(x).strip() for x in leg if str(x).strip())[:120]
    custom = str(persona.get("occupationCustom") or "").strip()
    occs = _persona_id_list(persona, "occupations", "occupation")
    occ_cn = _occ_map(platform)
    out: list[str] = []
    for occ in occs:
        if occ == "custom" and custom:
            out.append(custom[:40])
        elif occ != "custom":
            out.append(occ_cn.get(occ, occ))
    return "、".join(out) if out else "泛读者人群"


def _emoji_prompt_line(persona: dict[str, Any], extras: dict[str, Any]) -> str:
    styles = _persona_id_list(persona, "emojiStyles", "")
    if not styles and isinstance(extras.get("emojiStyles"), list):
        styles = [str(x).strip() for x in extras["emojiStyles"] if str(x).strip()]
    if "none" in styles:
        return "Emoji：正文与标题均不使用 emoji"
    if styles:
        hints = [_EMOJI_STYLE_CN.get(s, s) for s in styles if s != "none"]
        return (
            f"【Emoji 风格（小红书）】{'；'.join(hints)}；"
            "全文 emoji 建议 4～10 个，段首/清单优先，忌连续堆砌"
        )
    emoji = str(extras.get("emojiLevel") or "medium")
    if emoji == "none":
        return "Emoji：极少，不用作段首锚点"
    if emoji == "rich":
        return "Emoji：段首用 📌💡🚨✅ 作视觉锚点，全文不超过 8 个"
    return "Emoji：段首适度 📌💡，全文不超过 6 个"


def build_persona_prompt_block(options: dict[str, Any]) -> str:
    persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
    platform = str(options.get("platform") or "xiaohongshu").strip()
    other_req = str(
        persona.get("otherRequirements") or options.get("userNote") or ""
    ).strip()[:500]
    extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}

    genders = _persona_id_list(persona, "genders", "gender")
    gset = {g for g in genders if g}
    if "any" in gset or ("female" in gset and "male" in gset):
        genders = ["any"]
    elif gset:
        genders = [next(iter(gset))]
    ages = _persona_id_list(persona, "ageRanges", "ageRange")
    regions = _persona_id_list(persona, "regions", "region")
    interests = _persona_id_list(persona, "interests", "interest")
    voices = _persona_id_list(persona, "writerVoices", "writerVoice")

    if genders or ages or regions or voices or interests:
        gender_cn = _labels_from_map(genders, _GENDER_CN, "性别不限")
        age_cn = _labels_from_map(ages, _AGE_CN, "全年龄段")
        region_cn = _labels_from_map(regions, _REGION_CN, "地域不限")
        interest_cn = _labels_from_map(interests, _interest_map(platform), "")
        occ_cn = _resolve_occupation_labels(persona, platform)
        plat_cn = "微信公众号" if platform == "wechat_mp" else "小红书"
        lines = [
            f"【目标人群定位】（{plat_cn}，须融合为统一读者画像）",
            f"性别：{gender_cn}",
            f"年龄段：{age_cn}",
            f"地域：{region_cn}",
        ]
        if interest_cn:
            lines.append(f"兴趣爱好：{interest_cn}（内容垂类与话术贴近以上兴趣）")
        lines.append(f"职业：{occ_cn}")
        if voices:
            voice_cn = _WRITER_VOICE_CN.get(voices[0], voices[0])
            lines.append(f"【写作人设】{voice_cn}")
        else:
            lines.append("【写作人设】未指定，请根据素材推断合适口吻")
        if platform == "wechat_mp":
            lines.append("正文可用 Markdown（## 小标题、列表、引用），语气适合公众号深度阅读与转发")
        lines.append(_emoji_prompt_line(persona, extras))
        if other_req:
            lines.append(f"【其他要求】{other_req}")
    else:
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
        if other_req:
            lines.append(f"【其他要求】{other_req}")
        lines.append(_emoji_prompt_line(persona, extras))
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


def _section_item_to_markdown(item: Any) -> str:
    """将 sections 数组项转为 Markdown 段落（禁止 str(dict) 泄漏到正文）。"""
    if item is None:
        return ""
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        heading = str(
            item.get("heading")
            or item.get("title")
            or item.get("section_title")
            or item.get("name")
            or ""
        ).strip()
        content = str(
            item.get("content")
            or item.get("body")
            or item.get("text")
            or item.get("paragraph")
            or ""
        ).strip()
        parts: list[str] = []
        if heading:
            parts.append(heading if heading.startswith("#") else f"## {heading}")
        if content:
            parts.append(content)
        return "\n\n".join(parts)
    return str(item).strip()


def _format_sections_list(sections: list[Any]) -> str:
    blocks = [_section_item_to_markdown(s) for s in sections]
    blocks = [b for b in blocks if b]
    return "\n\n".join(blocks)


def _repair_python_dict_sections_in_body(body: str) -> str:
    """兜底：正文若已是 Python dict 字面量串，拆成 Markdown。"""
    raw = (body or "").strip()
    if not raw or ("'heading'" not in raw and '"heading"' not in raw):
        return raw
    if not re.search(r"['\"]heading['\"]\s*:", raw):
        return raw

    blocks = re.findall(
        r"\{\s*['\"]heading['\"]\s*:\s*['\"](.*?)['\"]\s*,\s*['\"]content['\"]\s*:\s*['\"](.*?)"
        r"['\"]\s*\}",
        raw,
        flags=re.DOTALL,
    )
    if not blocks:
        return raw
    parts: list[str] = []
    for heading, content in blocks:
        h = heading.strip()
        c = content.strip()
        if h:
            parts.append(h if h.startswith("#") else f"## {h}")
        if c:
            parts.append(c)
    repaired = "\n\n".join(parts).strip()
    return repaired if parts else raw


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
    titles = titles[:3]
    while len(titles) < 3:
        titles.append(titles[0] if titles else "笔记标题备选")

    opening = _clamp_opening_30(str(data.get("opening_30") or data.get("opening") or ""))
    if not opening:
        body_start = str(data.get("body") or "").strip()
        opening = _clamp_opening_30(body_start.split("\n")[0] if body_start else "你是不是也有这种困扰？")

    sections = data.get("sections")
    body_main = str(data.get("body") or "").strip()
    if isinstance(sections, list) and sections:
        sec_text = _format_sections_list(sections)
        if sec_text:
            body_main = sec_text
    body_main = body_main.replace("\\n\\n", "\n\n").replace("\\n", "\n")
    body_main = _repair_python_dict_sections_in_body(body_main)

    interaction = _parse_cta_blocks(data, str(data.get("interaction") or ""))
    if not interaction:
        interaction = "觉得有用先马住，评论区聊聊你的看法～"

    tags = normalize_tags(data.get("tags"))[:8]
    if len(tags) < 5 and tags:
        pass
    elif len(tags) > 8:
        tags = tags[:8]

    covers = (
        data.get("imageSuggestions")
        or data.get("image_suggestions")
        or data.get("coverSuggestions")
        or data.get("cover_suggestions")
    )
    cover_list: list[str] = []
    if isinstance(covers, list):
        cover_list = [str(c).strip()[:300] for c in covers if str(c).strip()][:4]

    theme = str(data.get("theme") or "").strip()[:500]
    return {
        "titles": titles[:3],
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
    compliance_max_llm_passes: int = 1,
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
    compliant_fields, compliance = apply_compliance_to_xhs_fields(
        fields,
        max_llm_passes=max(0, int(compliance_max_llm_passes)),
    )

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

    plat = str((options or {}).get("platform") or "xiaohongshu").strip()
    return xhs_pack_from_compliant_fields(
        compliant_fields,
        compliance=compliance,
        theme=norm["theme"],
        trace_id=trace_id,
        platform=plat,
    )
