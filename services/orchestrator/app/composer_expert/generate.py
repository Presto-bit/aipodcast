"""首页 Composer 专家交付物生成（P0：红书搭子）。"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from ..social_publish_draft import generate_social_publish_draft, resolve_social_publish_material
from .schema import validate_expert_deliverable

logger = logging.getLogger(__name__)

PLAYBOOK_VERSION = "xhs_ops@1"

_FALLBACK_XHS_TAGS = ["干货分享", "真实体验", "知识整理", "避坑指南", "收藏推荐"]

_XHS_LENGTH_CHARS = {"short": 400, "medium": 600, "long": 1200}
_XHS_TONE = {"casual": "casual", "pro": "pro", "sharp": "pro"}
_XHS_AUDIENCE = {"newcomer": "beginner", "peers": "pro", "general": "general"}
_XHS_NOTE_INTENT = {
    "howto": "dry_goods",
    "story": "story",
    "listicle": "checklist",
}

_XHS_FIELD_LABELS: dict[str, dict[str, str]] = {
    "audience": {"newcomer": "产品/行业新人", "peers": "同行从业者", "general": "泛用户/路人"},
    "noteType": {"howto": "干货教程", "story": "故事经历", "listicle": "清单体"},
    "purpose": {"acquire": "获客拉新", "retain": "复盘沉淀", "brand": "建立个人品牌"},
    "tone": {"casual": "口语亲切", "pro": "专业克制", "sharp": "观点鲜明"},
    "length": {"short": "短（约300字内）", "medium": "中（300–600字）", "long": "长（600字以上）"},
    "titleCount": {"1": "1个标题", "3": "3个标题", "5": "5个标题"},
    "withHashtags": {"yes": "要带话题", "no": "不要话题"},
}


def _intake_label(field: str, value: str) -> str:
    return _XHS_FIELD_LABELS.get(field, {}).get(value, value)


def _intake_human_summary(intake: dict[str, Any]) -> str:
    if not intake:
        return ""
    lines: list[str] = []
    field_prompts = {
        "audience": "受众",
        "noteType": "笔记类型",
        "purpose": "目的",
        "tone": "语气",
        "length": "长度",
        "titleCount": "标题数",
        "withHashtags": "话题",
    }
    for field, label in field_prompts.items():
        raw = intake.get(field)
        if raw is None or raw == "":
            continue
        ids = raw if isinstance(raw, list) else [raw]
        text = "、".join(_intake_label(field, str(v)) for v in ids if str(v).strip())
        if text:
            lines.append(f"{label}：{text}")
    return "；".join(lines)


def _compose_expert_writer_instructions(*, task_sentence: str, intake: dict[str, Any]) -> str:
    hints = [
        "你是小红书种草/推广笔记写手。根据用户任务与偏好，撰写完整、可直接发布的笔记 JSON。",
        "必须写出具体产品卖点、目标用户痛点、使用场景与行动引导，禁止空泛占位。",
        "禁止把任务描述或本说明文字照抄进正文；禁止输出「请先结论/展开」类模板结构。",
        f"任务核心：{task_sentence.strip()[:300]}",
    ]
    human = _intake_human_summary(intake)
    if human:
        hints.append(f"用户偏好：{human}")
    return "\n".join(hints)


def _looks_like_material_fallback(content: dict[str, Any], task_sentence: str) -> bool:
    body = str(content.get("body") or "")
    if "📌 先说结论" in body:
        if "请根据以下创作任务" in body or "【创作任务】" in body:
            return True
        task_head = task_sentence.strip()[:28]
        if task_head and task_head in body:
            return True
        tags = content.get("hashtags") or []
        if isinstance(tags, list) and tags == _FALLBACK_XHS_TAGS:
            return True
        if "你觉得哪一点最有用" in body:
            return True
    if "请根据以下创作任务" in body or "撰写一篇完整、可直接" in body:
        return True
    return False


def _intake_to_social_options(intake: dict[str, Any], task_sentence: str) -> dict[str, Any]:
    options: dict[str, Any] = {"platform": "xiaohongshu", "source_type": "composer_prompt"}
    tone = str(intake.get("tone") or "").strip()
    if tone in _XHS_TONE:
        options["tone"] = _XHS_TONE[tone]
    length = str(intake.get("length") or "").strip()
    if length in _XHS_LENGTH_CHARS:
        options["target_chars"] = _XHS_LENGTH_CHARS[length]
    audience_raw = intake.get("audience")
    aud_ids = audience_raw if isinstance(audience_raw, list) else [audience_raw]
    for aid in aud_ids:
        key = str(aid or "").strip()
        if key in _XHS_AUDIENCE:
            options["audience"] = _XHS_AUDIENCE[key]
            break
    note_type = str(intake.get("noteType") or "").strip()
    if note_type in _XHS_NOTE_INTENT:
        options["intent"] = _XHS_NOTE_INTENT[note_type]
    purpose_raw = intake.get("purpose")
    purposes = purpose_raw if isinstance(purpose_raw, list) else [purpose_raw]
    if "acquire" in [str(p) for p in purposes]:
        options["intent"] = "zhongcao"
    options["userNote"] = task_sentence[:500]
    return options


def _compose_expert_material_text(
    *,
    task_sentence: str,
    intake: dict[str, Any],
    style_prompt: str,
    author_prompt: str,
    feature_summary: str,
) -> str:
    """仅用户事实（【】段落），不含 LLM 指令，避免 fallback 泄漏到正文。"""
    parts = [f"【创作任务】\n{task_sentence.strip()}"]
    human = _intake_human_summary(intake)
    if human:
        parts.append(f"【创作偏好】\n{human}")
    if feature_summary.strip():
        parts.append(f"【作者特色】\n{feature_summary.strip()}")
    if style_prompt.strip():
        parts.append(f"【写作习惯】\n{style_prompt.strip()[:600]}")
    if author_prompt.strip():
        parts.append(f"【风格补充】\n{author_prompt.strip()[:600]}")
    return "\n\n".join(parts)


def _intake_summary(intake: dict[str, Any]) -> str:
    if not intake:
        return ""
    try:
        return json.dumps(intake, ensure_ascii=False)[:800]
    except (TypeError, ValueError):
        return str(intake)[:800]


def _extract_hashtags(pack: dict[str, Any], body: str) -> list[str]:
    tags: list[str] = []
    for i in range(12):
        key = f"tag_{i}"
        val = str(pack.get(key) or "").strip().lstrip("#")
        if val:
            tags.append(val)
    raw_tags = pack.get("tags")
    if isinstance(raw_tags, list):
        for t in raw_tags:
            s = str(t).strip().lstrip("#")
            if s:
                tags.append(s)
    if not tags and "#" in body:
        tags = [t for t in re.findall(r"#([^\s#，,]+)", body)][:10]
    return tags[:10] if tags else ["干货分享", "真实体验"]


def _corpus_coverage(note_count: int, used_rag: bool) -> str:
    if not used_rag or note_count <= 0:
        return "none"
    return "partial"


def _build_xhs_ops_steps(intake: dict[str, Any], headline: str) -> list[dict[str, Any]]:
    tone = str(intake.get("tone") or "casual")
    with_tags = str(intake.get("withHashtags") or "yes") != "no"
    tone_label = "口语亲切" if tone == "casual" else "专业克制"
    return [
        {
            "stepNo": 1,
            "title": "做图",
            "objective": "准备小红书封面与内页图",
            "actions": [
                f"封面大字写「{headline[:12]}」",
                "竖版 3:4，背景简洁，可用醒图/稿定",
                "内页图：截图标注或清单卡片 2～3 张",
            ],
            "tier": "must_do",
            "defaultExpanded": True,
        },
        {
            "stepNo": 2,
            "title": "标题",
            "objective": "选择最适合本次受众的标题",
            "actions": [
                "对比 3 个标题，选点击意图最明确的",
                "避免绝对化承诺与编造数据",
                "标题与封面大字保持一致",
            ],
            "tier": "must_do",
            "defaultExpanded": True,
        },
        {
            "stepNo": 3,
            "title": "正文",
            "objective": "发布前通读并微调口语度",
            "actions": [
                "首段 3 秒内交代价值",
                "中间干货分点，每点不超过 2 行",
                "结尾留一句互动或行动引导",
            ],
            "tier": "must_do",
            "defaultExpanded": True,
        },
        {
            "stepNo": 4,
            "title": "Tag",
            "objective": "添加话题提升发现率",
            "actions": [
                "核心 tag 2～3 个 + 流量 tag 2～3 个" if with_tags else "按需添加 3～5 个话题",
                "复制一行话题格式到发布页",
            ],
            "tier": "must_do",
            "defaultExpanded": True,
        },
        {
            "stepNo": 5,
            "title": "发布",
            "objective": "发布前最后检查",
            "actions": [
                "检查封面、标题、正文无错别字",
                "建议工作日 12:00–13:30 或 20:00–22:00 发布",
                "首发布置可见范围：公开",
            ],
            "tier": "must_do",
            "defaultExpanded": False,
            "collapsedSummary": "发布前 checklist + 时段建议",
        },
        {
            "stepNo": 6,
            "title": "互动",
            "objective": "发布后 30 分钟内完成首轮互动",
            "actions": [
                "发布后立即自评一条「求反馈/求收藏」首评",
                "准备 3 类评论回复：求资料 / 质疑 / 共鸣",
                f"语气保持{tone_label}",
            ],
            "tier": "nice_to_have",
            "defaultExpanded": False,
            "collapsedSummary": "首评 + 评论回复模板",
        },
        {
            "stepNo": 7,
            "title": "复盘",
            "objective": "24h / 7d 看数据并迭代",
            "actions": [
                "24h 看曝光、点击率；7d 看赞藏评",
                "数据一般：优先换封面或首段",
                "记录本次 intake 效果，下次同类任务复用",
            ],
            "tier": "after_publish",
            "defaultExpanded": False,
            "collapsedSummary": "24h/7d 指标 + 优化动作",
        },
    ]


def _pack_to_xhs_content(pack: dict[str, Any]) -> dict[str, Any]:
    titles_raw = pack.get("titles")
    titles: list[str] = []
    if isinstance(titles_raw, list):
        titles = [str(t).strip() for t in titles_raw if str(t).strip()]
    if not titles:
        hook = str(pack.get("cover_hook") or pack.get("title") or "").strip()
        if hook:
            titles = [hook]
    if not titles:
        titles = ["笔记标题"]
    body = str(pack.get("body") or "").strip()
    hashtags = _extract_hashtags(pack, body)
    headline = titles[0][:12]
    return {
        "titles": titles[:5],
        "body": body or titles[0],
        "hashtags": hashtags,
        "cover": {
            "headline": headline,
            "layout": "text_center",
            "slides": [
                {"role": "cover", "description": f"封面大字：{headline}"},
                {"role": "inner", "description": "干货要点截图或清单卡片"},
            ],
        },
    }


def _build_rationale_lines(
    *,
    task_sentence: str,
    intake: dict[str, Any],
    used_rag: bool,
    feature_summary: str,
    pack: dict[str, Any],
) -> list[str]:
    lines: list[str] = []
    human = _intake_human_summary(intake)
    if human:
        lines.append(f"按你的选项：{human}")
    else:
        lines.append("未选 intake 时按任务句推断结构与语气")
    if used_rag:
        lines.append("正文优先引用所选资料中的事实与案例")
    else:
        lines.append("基于你的任务描述扩写，发布前请核对产品细节")
    if feature_summary.strip():
        lines.append(f"已融入你的特色：{feature_summary[:60]}")
    theme = str(pack.get("theme") or "").strip()
    if theme:
        lines.append(f"成稿定位：{theme[:80]}")
    hook = str(pack.get("cover_hook") or "").strip()
    if hook:
        lines.append(f"封面/标题钩子方向：{hook[:40]}")
    return lines[:6]


def _expected_effect_line(intake: dict[str, Any]) -> str:
    purposes = intake.get("purpose")
    ids = purposes if isinstance(purposes, list) else [purposes]
    if "acquire" in [str(p) for p in ids]:
        return "适合信息流快刷场景，强调痛点与转化引导；发布后 24h 重点看点击与私信"
    if "retain" in [str(p) for p in ids]:
        return "偏复盘沉淀，适合收藏向；发布后关注收藏率与完读"
    return "提升可复制发布效率；发布后关注赞藏与评论互动"


def _assemble_xhs_deliverable(
    *,
    pack: dict[str, Any],
    intake: dict[str, Any],
    task_sentence: str,
    notebook: str,
    note_count: int,
    used_rag: bool,
    feature_summary: str,
) -> dict[str, Any]:
    content = _pack_to_xhs_content(pack)
    headline = str(content["cover"]["headline"])
    ops_steps = _build_xhs_ops_steps(intake, headline)
    coverage = _corpus_coverage(note_count, used_rag)
    material_labels = [f"{notebook} · {note_count} 篇"] if notebook and note_count else []

    meta: dict[str, Any] = {
        "rationale": _build_rationale_lines(
            task_sentence=task_sentence,
            intake=intake,
            used_rag=used_rag,
            feature_summary=feature_summary,
            pack=pack,
        ),
        "expectedEffect": _expected_effect_line(intake),
        "provenance": {
            "corpusCoverage": coverage,
            "materialLabels": material_labels,
        },
        "playbookVersion": PLAYBOOK_VERSION,
    }
    if feature_summary.strip():
        meta["featureUsage"] = {
            "applied": True,
            "summaryLine": f"特色：{feature_summary[:80]}",
        }

    return {
        "expertId": "xhs_ops",
        "content": content,
        "ops": {
            "expertId": "xhs_ops",
            "steps": ops_steps,
            "recapStepNo": 7,
        },
        "meta": meta,
    }


def generate_xhs_expert_deliverable(
    *,
    task_sentence: str,
    intake: dict[str, Any],
    material_text: str,
    options: dict[str, Any],
    notebook: str,
    note_count: int,
    used_rag: bool,
    feature_summary: str,
    on_stream_delta: Callable[[str], None] | None = None,
    validation_errors: list[str] | None = None,
) -> dict[str, Any]:
    extra = ""
    if validation_errors:
        extra = "\n\n【上次校验错误，须修正】\n" + "; ".join(validation_errors[:8])

    pack = generate_social_publish_draft(
        material_text + extra,
        platform="xiaohongshu",
        options=options,
        on_stream_delta=on_stream_delta,
    )
    deliverable = _assemble_xhs_deliverable(
        pack=pack,
        intake=intake,
        task_sentence=task_sentence,
        notebook=notebook,
        note_count=note_count,
        used_rag=used_rag,
        feature_summary=feature_summary,
    )
    errors = validate_expert_deliverable(deliverable)
    if errors:
        raise ValueError("validation_failed:" + "|".join(errors[:6]))
    return deliverable


def run_composer_expert_deliverable_job(
    *,
    payload: dict[str, Any],
    user_ref: str,
    on_progress: Callable[[str, float], None] | None = None,
) -> dict[str, Any]:
    expert_id = str(payload.get("expertId") or payload.get("expert_id") or "").strip()
    if expert_id != "xhs_ops":
        raise RuntimeError("expert_not_supported_yet")

    task_sentence = str(payload.get("taskSentence") or payload.get("task_sentence") or "").strip()
    if not task_sentence:
        raise RuntimeError("task_sentence_required")

    intake = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    notebook = str(payload.get("notes_notebook") or payload.get("notebook") or "").strip()
    nids = [
        str(x).strip()
        for x in (payload.get("selected_note_ids") or payload.get("noteIds") or [])
        if str(x).strip()
    ]
    used_rag = bool(nids) and bool(payload.get("use_rag", True))

    style_bits = [
        str(payload.get("style_prompt") or payload.get("stylePrompt") or "").strip(),
        str(payload.get("author_prompt") or payload.get("authorPrompt") or "").strip(),
    ]
    style_prompt = style_bits[0]
    author_prompt = style_bits[1]
    feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
    feature_summary = " · ".join(
        str(feature_core.get(k) or "").strip()
        for k in ("who", "remember", "avoid")
        if str(feature_core.get(k) or "").strip()
    )[:80]
    options = _intake_to_social_options(intake, task_sentence)
    writer_instructions = _compose_expert_writer_instructions(task_sentence=task_sentence, intake=intake)
    other_req = "\n\n".join(
        x
        for x in [writer_instructions, *style_bits, _intake_human_summary(intake)]
        if x
    )
    if other_req:
        persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
        persona["otherRequirements"] = other_req[:1600]
        options["persona"] = persona
    extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}
    extras["mustInclude"] = [
        "产品或主题的核心卖点",
        "目标用户痛点或使用场景",
        "可执行的行动引导（如试用/关注/评论）",
    ]
    options["extras"] = extras

    if on_progress:
        on_progress("正在检索资料…" if nids else "正在准备创作任务…", 20.0 if nids else 12.0)

    hint = other_req[:500]
    owner = str(payload.get("notes_source_owner_user_id") or "").strip() or None
    try:
        rag_cap = int(payload.get("rag_max_chars") or 56_000)
    except (TypeError, ValueError):
        rag_cap = 56_000

    if nids:
        material = resolve_social_publish_material(
            user_ref,
            selected_note_ids=nids,
            material_text=task_sentence,
            notes_source_owner_user_id=owner,
            use_rag=used_rag,
            rag_max_chars=rag_cap,
            reference_rag_mode=str(payload.get("reference_rag_mode") or "truncate"),
            material_hint=hint,
            source_type=str(payload.get("source_type") or "notes_rag"),
        )
    else:
        material = _compose_expert_material_text(
            task_sentence=task_sentence,
            intake=intake,
            style_prompt=style_prompt,
            author_prompt=author_prompt,
            feature_summary=feature_summary,
        )
        if len(material.strip()) < 8:
            raise RuntimeError("material_too_short")

    if on_progress:
        on_progress("正在生成内容成品与发布傻瓜包…", 55.0)

    last_errors: list[str] = []
    quality_retry = False
    for attempt in range(2):
        try:
            deliverable = generate_xhs_expert_deliverable(
                task_sentence=task_sentence,
                intake=intake,
                material_text=material,
                options=options,
                notebook=notebook,
                note_count=len(nids),
                used_rag=used_rag,
                feature_summary=feature_summary,
                validation_errors=last_errors or None,
            )
            content = deliverable.get("content") if isinstance(deliverable.get("content"), dict) else {}
            if (
                not used_rag
                and _looks_like_material_fallback(content, task_sentence)
                and not quality_retry
            ):
                quality_retry = True
                last_errors = [
                    "正文不得包含「请根据以下创作任务」等指令语或模板回退；须输出完整种草/推广笔记"
                ]
                if on_progress:
                    on_progress("初稿质量不足，正在重写…", 72.0)
                continue
            if on_progress:
                on_progress("内容成品就绪", 100.0)
            return {"success": True, "deliverable": deliverable, "playbookVersion": PLAYBOOK_VERSION}
        except ValueError as exc:
            msg = str(exc)
            if msg.startswith("validation_failed:"):
                last_errors = msg.split(":", 1)[1].split("|")
                if attempt == 0:
                    if on_progress:
                        on_progress("校验未通过，正在重试…", 70.0)
                    continue
            raise
    raise RuntimeError("expert_deliverable_validation_failed")
