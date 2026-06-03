"""首页 Composer 专家交付物生成（P0：红书搭子）。"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from ..social_llm_utils import invoke_and_parse_social_json
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


def _looks_like_xhs_template_body(content: dict[str, Any], task_sentence: str) -> bool:
    """识别模板回退或 LLM 空泛骨架稿（Composer 质量重试用）。"""
    body = str(content.get("body") or "")
    if not body.strip():
        return True
    template_markers = (
        "📌 先说结论",
        "💡 展开",
        "💡 其次",
        "✅ 最后",
        "要点一",
        "要点二",
        "先把最重要的信息说清楚",
        "请根据以下创作任务",
        "【创作任务】",
        "【创作偏好】",
        "撰写一篇完整、可直接",
        "你是不是也一到下午就脸垮",
        "先把作息和防晒稳住",
        "打工人熬夜党！百元搞定暗沉",
    )
    hits = sum(1 for m in template_markers if m in body)
    if hits >= 2:
        return True
    if hits >= 1 and any(x in body for x in ("📌 先说结论", "💡 展开", "💡 其次", "✅ 最后")):
        return True
    if "📌" in body and "💡" in body and len(body) < 500:
        return True
    task_head = task_sentence.strip()[:24]
    if task_head and len(task_head) >= 10 and task_head in body:
        return True
    tags = content.get("hashtags") or []
    if isinstance(tags, list) and tags == _FALLBACK_XHS_TAGS:
        return True
    if "你觉得哪一点最有用" in body and "📌" in body:
        return True
    return False


def _looks_like_material_fallback(content: dict[str, Any], task_sentence: str) -> bool:
    return _looks_like_xhs_template_body(content, task_sentence)


_XHS_NOTE_SKELETON = {
    "howto": "story_seed",
    "story": "story_seed",
    "listicle": "checklist",
}


def _composer_anti_template_extras(intake: dict[str, Any]) -> dict[str, Any]:
    note_type = str(intake.get("noteType") or "").strip()
    extras: dict[str, Any] = {
        "avoid": [
            "📌先说结论、💡展开、✅最后 等固定 emoji 分段",
            "首先/其次/最后 机械排比",
            "要点一/要点二 空泛占位",
            "与创作任务无关的通用护肤/熬夜等案例",
            "复述【创作任务】标签或说明文字",
        ],
        "emojiLevel": "light",
        "openingMode": "scene" if note_type == "story" else "pain_question",
    }
    skeleton = _XHS_NOTE_SKELETON.get(note_type)
    if skeleton:
        extras["bodySkeleton"] = skeleton
    return extras


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
    options["extras"] = _composer_anti_template_extras(intake)
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


_XHS_OPS_STEP_TITLES = ("做图", "标题", "正文", "Tag", "发布", "互动", "复盘")
_XHS_OPS_TIER_BY_STEP = {
    1: "must_do",
    2: "must_do",
    3: "must_do",
    4: "must_do",
    5: "must_do",
    6: "nice_to_have",
    7: "after_publish",
}
_XHS_OPS_EXPANDED_BY_STEP = {1: True, 2: True, 3: True, 4: True, 5: False, 6: False, 7: False}

_XHS_OPS_LLM_SYSTEM = """你是小红书发布教练。根据已生成的笔记成品，输出 7 步发布傻瓜包 JSON。
每一步须引用成品中的具体标题、正文片段、话题、封面/配图说明，禁止空泛通用话术。
输出纯 JSON 对象，不要 markdown 代码块：
{
  "steps": [
    {
      "stepNo": 1,
      "title": "做图",
      "objective": "一句说明本步目标",
      "actions": ["至少 2 条，须引用成品具体内容"],
      "tier": "must_do",
      "defaultExpanded": true,
      "copyBlocks": [{"label": "可复制的标签", "text": "可复制正文"}],
      "collapsedSummary": "折叠时一行摘要（可选）"
    }
  ]
}
固定 7 步，stepNo 1～7，title 依次为：做图、标题、正文、Tag、发布、互动、复盘。
tier：1～5 步 must_do；第 6 步 nice_to_have；第 7 步 after_publish。
defaultExpanded：1～4 步 true，5～7 步 false。
第 2 步 copyBlocks 须含各备选标题；第 4 步 copyBlocks 须含一行话题；第 6 步 copyBlocks 须含首评与 1～2 条回复模板。"""


def _body_excerpt(body: str, max_chars: int = 80) -> str:
    text = body.strip().replace("\n\n", " ").replace("\n", " ")
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "…"


def _slides_from_pack(pack: dict[str, Any], headline: str) -> list[dict[str, str]]:
    imgs = pack.get("imageSuggestions")
    slides: list[dict[str, str]] = []
    if isinstance(imgs, list):
        for i, item in enumerate(imgs[:6]):
            desc = str(item).strip()
            if not desc:
                continue
            role = "cover" if i == 0 else "inner"
            slides.append({"role": role, "description": desc})
    if slides:
        return slides
    return [
        {"role": "cover", "description": f"封面大字：{headline}"},
        {"role": "inner", "description": "干货要点截图或清单卡片"},
    ]


def _normalize_ops_step(raw: dict[str, Any], step_no: int) -> dict[str, Any]:
    title = str(raw.get("title") or _XHS_OPS_STEP_TITLES[step_no - 1]).strip()
    objective = str(raw.get("objective") or "").strip()
    actions_raw = raw.get("actions")
    actions = [str(a).strip() for a in actions_raw if str(a).strip()] if isinstance(actions_raw, list) else []
    if not objective:
        objective = f"完成「{title}」相关发布准备"
    if len(actions) < 2:
        actions = [f"按本步目标处理「{title}」", "对照成品 Tab 核对细节"]
    copy_blocks_raw = raw.get("copyBlocks")
    copy_blocks: list[dict[str, str]] = []
    if isinstance(copy_blocks_raw, list):
        for block in copy_blocks_raw:
            if not isinstance(block, dict):
                continue
            label = str(block.get("label") or "").strip()
            text = str(block.get("text") or "").strip()
            if label and text:
                copy_blocks.append({"label": label, "text": text})
    step: dict[str, Any] = {
        "stepNo": step_no,
        "title": title,
        "objective": objective,
        "actions": actions[:8],
        "tier": _XHS_OPS_TIER_BY_STEP.get(step_no, "must_do"),
        "defaultExpanded": _XHS_OPS_EXPANDED_BY_STEP.get(step_no, False),
    }
    collapsed = str(raw.get("collapsedSummary") or "").strip()
    if collapsed:
        step["collapsedSummary"] = collapsed
    elif step_no >= 5:
        step["collapsedSummary"] = objective[:40]
    if copy_blocks:
        step["copyBlocks"] = copy_blocks[:6]
    return step


def _normalize_ops_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    if len(steps) != 7:
        return None
    by_no: dict[int, dict[str, Any]] = {}
    for item in steps:
        if not isinstance(item, dict):
            return None
        step_no = item.get("stepNo")
        if not isinstance(step_no, int) or step_no < 1 or step_no > 7:
            return None
        by_no[step_no] = _normalize_ops_step(item, step_no)
    if set(by_no) != set(range(1, 8)):
        return None
    return [by_no[i] for i in range(1, 8)]


def _build_xhs_ops_from_content(
    content: dict[str, Any],
    pack: dict[str, Any],
    intake: dict[str, Any],
) -> list[dict[str, Any]]:
    titles = [str(t).strip() for t in (content.get("titles") or []) if str(t).strip()]
    body = str(content.get("body") or "").strip()
    hashtags = [str(t).strip().lstrip("#") for t in (content.get("hashtags") or []) if str(t).strip()]
    cover = content.get("cover") if isinstance(content.get("cover"), dict) else {}
    headline = str(cover.get("headline") or (titles[0] if titles else "")).strip()
    slides = cover.get("slides") if isinstance(cover.get("slides"), list) else []
    interaction = str(pack.get("interaction") or "").strip()
    tone = str(intake.get("tone") or "casual")
    tone_label = "口语亲切" if tone == "casual" else "专业克制"

    slide_actions: list[str] = []
    for slide in slides[:5]:
        if not isinstance(slide, dict):
            continue
        role = "封面" if slide.get("role") == "cover" else "内页"
        desc = str(slide.get("description") or "").strip()
        if desc:
            slide_actions.append(f"{role}：{desc}")
    if not slide_actions:
        slide_actions = [f"封面大字写「{headline[:12]}」", "竖版 3:4，背景简洁"]

    title_actions = [f"备选 {idx + 1}：{title[:28]}" for idx, title in enumerate(titles[:3])]
    title_actions.append("选与封面大字、首段价值最匹配的一条")
    title_copy = [{"label": f"标题 {idx + 1}", "text": title} for idx, title in enumerate(titles[:3])]

    body_lines = [line.strip() for line in body.split("\n") if line.strip()]
    body_actions: list[str] = []
    if body_lines:
        body_actions.append(f"首段要点：{_body_excerpt(body_lines[0], 72)}")
    if len(body_lines) > 1:
        body_actions.append(f"正文共 {len(body_lines)} 段，发布前通读并微调{tone_label}度")
    body_actions.append("确认无编造数据、绝对化承诺与敏感表述")
    body_copy = [{"label": "正文全文", "text": body}] if body else []

    tag_line = " ".join(f"#{tag}" for tag in hashtags[:8])
    tag_actions: list[str] = []
    if hashtags:
        tag_actions.append(f"本稿话题：{'、'.join(hashtags[:6])}")
    tag_actions.append("复制下方一行到发布页话题栏")
    tag_copy = [{"label": "话题一行", "text": tag_line}] if tag_line else []

    publish_actions = [
        f"封面 headline「{headline[:16]}」与所选标题一致",
        "检查封面、标题、正文无错别字",
        "建议工作日 12:00–13:30 或 20:00–22:00 发布",
    ]

    interact_actions = [
        "发布后立即自评一条，引导收藏/评论",
        f"回复评论时保持{tone_label}",
        "准备共鸣、质疑、求资料三类回复",
    ]
    interact_copy: list[dict[str, str]] = []
    if interaction:
        interact_copy.append({"label": "首评/互动引导", "text": interaction})
    if body_lines:
        interact_copy.append(
            {"label": "共鸣回复示例", "text": f"同感！{_body_excerpt(body_lines[-1], 48)}"}
        )

    recap_actions = [
        "24h 看曝光、点击率；7d 看赞藏评",
        "数据一般：优先换封面或首段",
        f"记录本次选题「{headline[:16]}」效果，下次同类任务复用",
    ]

    raw_steps = [
        {
            "stepNo": 1,
            "title": "做图",
            "objective": f"按本稿封面「{headline[:16]}」准备 {len(slides) or 2} 张配图",
            "actions": slide_actions,
            "tier": "must_do",
            "defaultExpanded": True,
        },
        {
            "stepNo": 2,
            "title": "标题",
            "objective": "从本稿备选标题中选最适合的一条",
            "actions": title_actions,
            "tier": "must_do",
            "defaultExpanded": True,
            "copyBlocks": title_copy,
        },
        {
            "stepNo": 3,
            "title": "正文",
            "objective": "发布前通读本稿正文并微调口语度",
            "actions": body_actions,
            "tier": "must_do",
            "defaultExpanded": True,
            "copyBlocks": body_copy,
        },
        {
            "stepNo": 4,
            "title": "Tag",
            "objective": "添加本稿话题提升发现率",
            "actions": tag_actions,
            "tier": "must_do",
            "defaultExpanded": True,
            "copyBlocks": tag_copy,
        },
        {
            "stepNo": 5,
            "title": "发布",
            "objective": "发布前最后检查",
            "actions": publish_actions,
            "tier": "must_do",
            "defaultExpanded": False,
            "collapsedSummary": "发布前 checklist + 时段建议",
        },
        {
            "stepNo": 6,
            "title": "互动",
            "objective": "发布后 30 分钟内完成首轮互动",
            "actions": interact_actions,
            "tier": "nice_to_have",
            "defaultExpanded": False,
            "collapsedSummary": "首评 + 评论回复模板",
            "copyBlocks": interact_copy,
        },
        {
            "stepNo": 7,
            "title": "复盘",
            "objective": "24h / 7d 看数据并迭代",
            "actions": recap_actions,
            "tier": "after_publish",
            "defaultExpanded": False,
            "collapsedSummary": "24h/7d 指标 + 优化动作",
        },
    ]
    return [_normalize_ops_step(step, step["stepNo"]) for step in raw_steps]


def _try_llm_xhs_ops_steps(
    *,
    content: dict[str, Any],
    pack: dict[str, Any],
    intake: dict[str, Any],
    task_sentence: str,
) -> list[dict[str, Any]] | None:
    payload = {
        "titles": content.get("titles"),
        "body": content.get("body"),
        "hashtags": content.get("hashtags"),
        "cover": content.get("cover"),
        "interaction": pack.get("interaction"),
        "theme": pack.get("theme"),
        "intakeSummary": _intake_human_summary(intake),
    }
    user = (
        f"任务：{task_sentence.strip()[:300]}\n"
        f"成品 JSON：\n{json.dumps(payload, ensure_ascii=False)[:4500]}"
    )
    parsed, _ = invoke_and_parse_social_json(_XHS_OPS_LLM_SYSTEM, user, max_tokens=2200)
    if not isinstance(parsed, dict):
        return None
    steps_raw = parsed.get("steps")
    if not isinstance(steps_raw, list):
        return None
    steps_in: list[dict[str, Any]] = [s for s in steps_raw if isinstance(s, dict)]
    normalized = _normalize_ops_steps(steps_in)
    if normalized is None:
        logger.warning("xhs ops llm returned invalid step count: %s", len(steps_in))
    return normalized


def _generate_xhs_ops_steps(
    *,
    content: dict[str, Any],
    pack: dict[str, Any],
    intake: dict[str, Any],
    task_sentence: str,
) -> list[dict[str, Any]]:
    llm_steps = _try_llm_xhs_ops_steps(
        content=content,
        pack=pack,
        intake=intake,
        task_sentence=task_sentence,
    )
    if llm_steps:
        return llm_steps
    return _build_xhs_ops_from_content(content, pack, intake)


def _deliverable_body_from_pack(pack: dict[str, Any], hashtags: list[str]) -> str:
    """从 pack 全量 body 去掉末尾话题行与互动句，避免 UI 重复展示。"""
    body = str(pack.get("body") or "").strip()
    interaction = str(pack.get("interaction") or "").strip()
    if interaction and body.endswith(interaction):
        body = body[: -len(interaction)].rstrip()
    if hashtags:
        tag_line = " ".join(f"#{h.lstrip('#')}" for h in hashtags[:8])
        if tag_line and body.endswith(tag_line):
            body = body[: -len(tag_line)].rstrip()
        lines = body.split("\n")
        if lines:
            last = lines[-1].strip()
            if last.startswith("#") and last.count("#") >= 2:
                body = "\n".join(lines[:-1]).rstrip()
    return body.strip() or str(pack.get("body") or "").strip()


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
    body = _deliverable_body_from_pack(pack, hashtags)
    return {
        "titles": titles[:5],
        "body": body or titles[0],
        "hashtags": hashtags,
        "cover": {
            "headline": headline,
            "layout": "text_center",
            "slides": _slides_from_pack(pack, headline),
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
    ops_steps = _generate_xhs_ops_steps(
        content=content,
        pack=pack,
        intake=intake,
        task_sentence=task_sentence,
    )
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
    max_attempts = 3
    for attempt in range(max_attempts):
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
            if _looks_like_xhs_template_body(content, task_sentence) and attempt < max_attempts - 1:
                last_errors = [
                    "正文须为围绕【创作任务】的具体种草/推广笔记；"
                    "禁止📌先说结论/💡展开等模板分段、要点一二三、与任务无关的通用占位"
                ]
                persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
                retry_note = "【重试】上次正文像通用模板，须重写：引用任务中的产品/场景/卖点，用自然段表达。"
                persona["otherRequirements"] = f"{persona.get('otherRequirements') or ''}\n{retry_note}"[:1600]
                options["persona"] = persona
                extras = options.get("extras") if isinstance(options.get("extras"), dict) else {}
                avoid = list(extras.get("avoid") or [])
                avoid.append("任何与任务无关的虚构案例")
                extras["avoid"] = avoid
                options["extras"] = extras
                if on_progress:
                    on_progress("初稿偏模板化，正在重写…", 72.0)
                continue
            if on_progress:
                on_progress("内容成品就绪", 100.0)
            return {"success": True, "deliverable": deliverable, "playbookVersion": PLAYBOOK_VERSION}
        except ValueError as exc:
            msg = str(exc)
            if msg.startswith("validation_failed:"):
                last_errors = msg.split(":", 1)[1].split("|")
                if attempt < max_attempts - 1:
                    if on_progress:
                        on_progress("校验未通过，正在重试…", 70.0)
                    continue
            raise
    raise RuntimeError("expert_deliverable_validation_failed")
