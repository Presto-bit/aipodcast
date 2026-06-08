"""首页 Composer 专家交付物生成（P0：红书搭子）。"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from ..social_llm_utils import invoke_and_parse_social_json
from ..social_publish_draft import generate_social_publish_draft, resolve_social_publish_material
from .intake import _infer_xhs
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
    "accountStage": {
        "cold_start": "新号起号",
        "steady": "稳定更新",
        "convert": "转化变现",
        "brand": "品牌/企业号",
    },
    "audience": {
        "newcomer": "入门小白",
        "peers": "同行从业者",
        "buyer": "决策购买用户",
        "general": "泛流量路人",
    },
    "contentAngle": {
        "review": "测评种草",
        "tutorial": "教程SOP",
        "listicle": "避坑清单",
        "story": "经历故事",
        "opinion": "观点态度",
    },
    "publishGoal": {
        "expose": "曝光破圈",
        "save": "高收藏",
        "comment": "评论互动",
        "dm": "引导私信",
        "follow": "涨粉关注",
    },
    "hookStyle": {
        "pain_question": "痛点提问",
        "number": "数字结果",
        "contrast": "反常识对比",
        "scene": "场景代入",
    },
    "structure": {
        "bullet": "分点清单",
        "steps": "步骤教程",
        "story_arc": "故事线",
        "compare": "对比测评",
    },
    "noteType": {"howto": "干货教程", "story": "故事经历", "listicle": "清单体"},
    "purpose": {"acquire": "获客拉新", "retain": "复盘沉淀", "brand": "建立个人品牌"},
    "tone": {"casual": "口语亲切", "pro": "专业克制", "sharp": "观点鲜明"},
    "length": {"short": "短（约250字内）", "medium": "中（250–500字）", "long": "长（500字以上）"},
    "titleCount": {"1": "1个标题", "3": "3个标题", "5": "5个标题"},
    "withHashtags": {"yes": "要带话题", "no": "不要话题"},
    "ctaStyle": {"save": "求收藏", "comment": "求评论", "soft_dm": "软引导私信", "none": "弱CTA"},
    "visualStyle": {
        "big_type": "大字报封面",
        "photo": "实拍场景",
        "screenshot": "截图标注",
        "infographic": "信息图",
    },
}


def _intake_label(field: str, value: str) -> str:
    return _XHS_FIELD_LABELS.get(field, {}).get(value, value)


def _intake_human_summary(intake: dict[str, Any]) -> str:
    if not intake:
        return ""
    lines: list[str] = []
    field_prompts = {
        "accountStage": "账号阶段",
        "audience": "读者",
        "contentAngle": "切入角度",
        "publishGoal": "发布目标",
        "hookStyle": "开头钩子",
        "structure": "正文结构",
        "noteType": "笔记类型",
        "purpose": "目的",
        "tone": "语气",
        "length": "长度",
        "titleCount": "标题数",
        "withHashtags": "话题",
        "ctaStyle": "行动引导",
        "visualStyle": "配图风格",
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


def _ensure_intake_from_task(intake: dict[str, Any], task_sentence: str) -> dict[str, Any]:
    """成稿前隐式结构档位：任务句推断 intake，用户无感。"""
    merged = dict(intake or {})
    if not str(merged.get("contentAngle") or "").strip() and not str(merged.get("noteType") or "").strip():
        inferred, _, _ = _infer_xhs(task_sentence)
        for key, val in inferred.items():
            merged.setdefault(key, val)
    merged.setdefault("titleCount", "3")
    merged.setdefault("withHashtags", "yes")
    return merged


_OPENING_HOOK_MARKERS = (
    "你是不是",
    "别再",
    "原来",
    "说实话",
    "千万别",
    "为什么",
    "？",
    "！",
    "打工人",
    "宝妈",
    "深夜",
    "终于",
    "我",
)


def _xhs_opening_hook_errors(content: dict[str, Any]) -> list[str]:
    body = str(content.get("body") or "").strip()
    if not body:
        return []
    opening = body[:120].replace("\n", " ")
    if len(opening) < 12:
        return ["开头前两行过短，须有具体场景、痛点问句或反常识钩子"]
    weak_open = ("很多人", "大家都知道", "近年来", "随着", "在当今", "众所周知")
    if opening.startswith(weak_open) and "？" not in opening[:40]:
        return ["开头禁止空泛铺垫（如「很多人/近年来」），前两行须有痛点问句或具体场景"]
    if any(m in opening for m in _OPENING_HOOK_MARKERS):
        return []
    if re.search(r"\d+", opening[:60]):
        return []
    return ["开头前两行须有具体场景、痛点问句、数字结果或反常识钩子，禁止温吞开场"]


def _xhs_corpus_anchor_errors(content: dict[str, Any], *, used_rag: bool) -> list[str]:
    if not used_rag:
        return []
    body = str(content.get("body") or "")
    markers = ("[资料", "资料中提到", "根据所选资料", "笔记里提到", "摘录中", "你勾选的")
    if any(m in body for m in markers):
        return []
    return ["正文须含 1～2 处来自勾选资料的可核查细节，可用「资料中提到…」或 [资料1] 标注"]


def _compose_expert_writer_instructions(
    *, task_sentence: str, intake: dict[str, Any], used_rag: bool = False
) -> str:
    hints = [
        "你是小红书种草/推广笔记写手。根据用户任务与偏好，撰写完整、可直接发布的笔记 JSON。",
        "必须写出具体产品卖点、目标用户痛点、使用场景与行动引导，禁止空泛占位。",
        "输出必须是可直接发布的种草/推广笔记正文，禁止写「怎么写钩子/步骤拆解/同行可套用/今天拆解写法」类创作课或方法论。",
        "禁止把任务描述或本说明文字照抄进正文；禁止输出「请先结论/展开」类模板结构。",
        "正文须分段：每段不超过 80 字，段间空行；清单体用「·」或 ①②③ 分行，禁止整屏大段文字。",
        "标题中的数量承诺（如「3个坑」「三大误区」）须与正文分点条数完全一致，禁止标题写 3 条正文列 4 条。",
        "titles 数组须恰好 3 个备选标题（痛点型/好奇型/数字型各一，每个≤20字）。",
        "bodies 数组须恰好 3 个正文变体，与 titles 顺序一一对应（痛点向/好奇向/数字向），每篇须是独立成稿，正文角度与写法须明显不同，禁止只改标题。",
        "interactions 数组须恰好 3 个互动引导句，与 titles/bodies 一一对应，语气随各方向变化。",
        "开头前两行须有强钩子：具体场景、痛点问句、数字结果或反常识，禁止「很多人/近年来」式空泛开场。",
        "正文段内用句号衔接，避免连续空行；可用 sections 或 body，但优先输出 bodies 数组。",
        f"任务核心：{task_sentence.strip()[:300]}",
    ]
    if used_rag:
        hints.append(
            "正文至少 1～2 处引用勾选资料的可核查细节，用「资料中提到…」或 [资料1] 标注，禁止编造资料未提及的数据。"
        )
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
    if "账号阶段：" in body and "读者：" in body:
        return True
    if "正文须为围绕【创作任务】" in body or "禁止📌先说结论" in body:
        return True
    tags = content.get("hashtags") or []
    if isinstance(tags, list) and tags == _FALLBACK_XHS_TAGS:
        return True
    if "你觉得哪一点最有用" in body and "📌" in body:
        return True
    tutorial_meta = (
        "今天拆解",
        "同行可直接套用",
        "第一步：",
        "第二步：",
        "第三步：",
        "开头钩子写法",
        "试试这个公式",
    )
    if sum(1 for m in tutorial_meta if m in body) >= 2:
        return True
    return False


def _looks_like_material_fallback(content: dict[str, Any], task_sentence: str) -> bool:
    return _looks_like_xhs_template_body(content, task_sentence)


_CN_COUNT_CHAR = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}

_LIST_ITEM_LINE_RE = re.compile(
    r"^(?:[①②③④⑤⑥⑦⑧⑨⑩]|"
    r"[1-9]\d{0,1}[\.、)\]]\s*|"
    r"[·•\-]\s+)"
)


def _promised_list_count_from_title(title: str) -> int | None:
    t = title.strip()
    patterns = (
        r"(\d+)\s*个",
        r"(\d+)\s*条",
        r"(\d+)\s*点",
        r"(\d+)\s*招",
        r"([一二两三四五六七八九十])\s*个",
        r"([一二两三四五六七八九十])\s*条",
        r"([一二两三四五六七八九十])\s*点",
    )
    for pat in patterns:
        m = re.search(pat, t)
        if not m:
            continue
        raw = m.group(1)
        if raw.isdigit():
            n = int(raw)
        else:
            n = _CN_COUNT_CHAR.get(raw)
        if n is not None and 2 <= n <= 12:
            return n
    return None


def _count_body_list_items(body: str) -> int:
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    marked = sum(1 for ln in lines if _LIST_ITEM_LINE_RE.match(ln))
    if marked >= 2:
        return marked
    blocks = [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]
    if 2 <= len(blocks) <= 12:
        return len(blocks)
    return marked


def _expand_bodies_to_three(bodies: list[str], titles: list[str], fallback: str) -> list[str]:
    """模型常只回 1 个 body：按方向补齐 3 套完整正文变体。"""
    cleaned = [str(b).strip() for b in bodies if str(b).strip()]
    seed = cleaned[0] if cleaned else str(fallback or "").strip()
    if not seed:
        return []
    title_list = [str(t).strip() for t in titles if str(t).strip()][:3]
    while len(title_list) < 3:
        title_list.append(title_list[0] if title_list else "")
    out: list[str] = []
    for i in range(3):
        if i < len(cleaned):
            out.append(cleaned[i])
            continue
        title = title_list[i]
        if i == 0:
            out.append(seed)
        elif i == 1:
            hook = title or "这件事"
            out.append(f"先别划走——{hook}到底怎么回事？{seed}")
        else:
            lead = title or "这3点"
            out.append(f"{lead}：我踩坑后总结了3条。{seed}")
    return out[:3]


def _expand_interactions_to_three(interactions: list[str], fallback: str) -> list[str]:
    """模型常只回 1 个 interaction：按方向补齐 3 套互动句。"""
    cleaned = [str(x).strip() for x in interactions if str(x).strip()]
    seed = cleaned[0] if cleaned else str(fallback or "").strip()
    defaults = (
        seed or "你最怕哪一步？评论区说说。",
        "还想看后续吗？评论告诉我你最关心什么。",
        "你踩过几个坑？评论报数字，我帮你对号入座。",
    )
    out: list[str] = []
    for i in range(3):
        if i < len(cleaned):
            out.append(cleaned[i])
        elif i == 0 and seed:
            out.append(seed)
        else:
            out.append(defaults[i])
    return out[:3]


def _xhs_bodies_count_errors(content: dict[str, Any]) -> list[str]:
    """成稿硬校验：pack 已补齐 3 套，仅无正文时失败。"""
    bodies = content.get("bodies")
    if not isinstance(bodies, list):
        return ["bodies 须为数组"]
    filled = [str(b).strip() for b in bodies if str(b).strip()]
    if not filled:
        return ["bodies 不能为空"]
    return []


def _xhs_bodies_need_retry(content: dict[str, Any]) -> list[str]:
    """模型未输出 3 个变体时触发重试（最后一轮由 pack 自动补齐）。"""
    titles = content.get("titles")
    if not isinstance(titles, list) or len([str(t).strip() for t in titles if str(t).strip()]) < 3:
        return []
    raw = content.get("_rawBodiesCount")
    if isinstance(raw, int) and raw < 3:
        return [f"bodies 须恰好 3 个，当前 {raw} 个"]
    return []


def _xhs_title_body_count_errors(content: dict[str, Any]) -> list[str]:
    """标题数量承诺与正文分点不一致时触发重试。"""
    titles = content.get("titles")
    if not isinstance(titles, list) or not titles:
        return []
    primary = str(titles[0] or "").strip()
    promised = _promised_list_count_from_title(primary)
    if promised is None:
        return []
    body = str(content.get("body") or "")
    actual = _count_body_list_items(body)
    if actual < 2 or actual == promised:
        return []
    return [
        f"标题承诺 {promised} 条要点，正文清单为 {actual} 条；须改标题或改正文使数量一致"
    ]


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
            "单段超过80字的密集文字墙",
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
    angle = str(intake.get("contentAngle") or "").strip()
    if not note_type and angle:
        angle_to_note = {
            "listicle": "listicle",
            "story": "story",
            "review": "howto",
            "tutorial": "howto",
            "opinion": "howto",
        }
        note_type = angle_to_note.get(angle, "howto")
    if note_type in _XHS_NOTE_INTENT:
        options["intent"] = _XHS_NOTE_INTENT[note_type]
    purpose_raw = intake.get("purpose")
    purposes = purpose_raw if isinstance(purpose_raw, list) else [purpose_raw]
    if "acquire" in [str(p) for p in purposes]:
        options["intent"] = "zhongcao"
    options["userNote"] = task_sentence[:500]
    extras = _composer_anti_template_extras(intake)
    extras = _apply_intake_visual_extras(intake, extras)
    options["extras"] = extras
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
第 2 步 copyBlocks 须含各备选标题；第 4 步 copyBlocks 须含一行话题；第 6 步 copyBlocks 须含首评与 1～2 条回复模板。
actions 与 copyBlocks 勿重复粘贴同一全文；每步 actions 最多 3 条，要短。"""


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
        "actions": actions[:3],
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


def _format_xhs_body_readable(body: str, *, max_para_chars: int = 80) -> str:
    """拆过长段落，提升小红书正文可读性。"""
    text = (body or "").replace("\r\n", "\n").strip()
    if not text:
        return text
    blocks = re.split(r"\n{2,}", text)
    out_blocks: list[str] = []
    for block in blocks:
        chunk = block.strip()
        if not chunk:
            continue
        if chunk.startswith("#") or chunk.startswith("·") or chunk.startswith("-"):
            out_blocks.append(chunk)
            continue
        if len(chunk) <= max_para_chars:
            out_blocks.append(chunk)
            continue
        sentences = re.split(r"(?<=[。！？；])\s*", chunk)
        buf = ""
        for sent in sentences:
            s = sent.strip()
            if not s:
                continue
            if len(buf) + len(s) > max_para_chars and buf:
                out_blocks.append(buf.strip())
                buf = s
            else:
                buf = f"{buf}{s}" if buf else s
        if buf.strip():
            out_blocks.append(buf.strip())
    return "\n\n".join(out_blocks)


def _apply_intake_visual_extras(intake: dict[str, Any], extras: dict[str, Any]) -> dict[str, Any]:
    hook = str(intake.get("hookStyle") or "").strip()
    hook_map = {
        "pain_question": "pain_question",
        "number": "number",
        "contrast": "contrast",
        "scene": "scene",
    }
    if hook in hook_map:
        extras["openingMode"] = hook_map[hook]
    struct = str(intake.get("structure") or "").strip()
    struct_map = {
        "bullet": "checklist",
        "steps": "dry_goods",
        "story_arc": "story_seed",
        "compare": "dry_goods",
    }
    if struct in struct_map:
        extras["bodySkeleton"] = struct_map[struct]
    visual = str(intake.get("visualStyle") or "").strip()
    if visual == "big_type":
        extras["coverHookStyle"] = "pain"
    return extras


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

    if not slide_actions:
        slide_actions = [f"封面 headline「{headline[:12]}」", "竖版 3:4"]

    title_copy = [{"label": f"标题 {idx + 1}", "text": title} for idx, title in enumerate(titles[:3])]
    tag_line = " ".join(f"#{tag}" for tag in hashtags[:8])
    tag_copy = [{"label": "话题一行", "text": tag_line}] if tag_line else []
    body_copy = [{"label": "正文全文", "text": body}] if body else []

    interact_copy: list[dict[str, str]] = []
    if interaction:
        interact_copy.append({"label": "首评/互动引导", "text": interaction})

    raw_steps = [
        {
            "stepNo": 1,
            "title": "做图",
            "objective": f"按封面「{headline[:14]}」准备配图",
            "actions": slide_actions[:3],
            "tier": "must_do",
            "defaultExpanded": True,
        },
        {
            "stepNo": 2,
            "title": "标题",
            "objective": "从备选标题中选一条发布",
            "actions": ["选点击意图最明确的一条", "与封面 headline 一致"],
            "tier": "must_do",
            "defaultExpanded": True,
            "copyBlocks": title_copy,
        },
        {
            "stepNo": 3,
            "title": "正文",
            "objective": "通读并微调语气后发布",
            "actions": ["核对事实与表述", f"保持{tone_label}"],
            "tier": "must_do",
            "defaultExpanded": True,
            "copyBlocks": body_copy,
        },
        {
            "stepNo": 4,
            "title": "Tag",
            "objective": "添加本稿话题",
            "actions": ["复制下方一行到发布页"],
            "tier": "must_do",
            "defaultExpanded": True,
            "copyBlocks": tag_copy,
        },
        {
            "stepNo": 5,
            "title": "发布",
            "objective": "发布前最后检查",
            "actions": [
                "封面/标题/正文无错别字",
                "建议 12:00–13:30 或 20:00–22:00 发布",
            ],
            "tier": "must_do",
            "defaultExpanded": False,
            "collapsedSummary": "发布前 checklist",
        },
        {
            "stepNo": 6,
            "title": "互动",
            "objective": "发布后 30 分钟内首轮互动",
            "actions": ["发自评引导收藏/评论", f"回复保持{tone_label}"],
            "tier": "nice_to_have",
            "defaultExpanded": False,
            "collapsedSummary": "首评 + 回复",
            "copyBlocks": interact_copy,
        },
        {
            "stepNo": 7,
            "title": "复盘",
            "objective": "24h / 7d 看数据并迭代",
            "actions": [
                "24h 看曝光/点击率，7d 看赞藏评",
                "数据弱则优先换封面或首段",
            ],
            "tier": "after_publish",
            "defaultExpanded": False,
            "collapsedSummary": "数据复盘",
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


def _format_single_xhs_body(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    return _format_xhs_body_readable(text)


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
    single_body = _format_xhs_body_readable(_deliverable_body_from_pack(pack, hashtags))

    formatted_bodies: list[str] = []
    raw_bodies_count = 0
    bodies_raw = pack.get("bodies")
    if isinstance(bodies_raw, list):
        raw_bodies_count = len([str(b).strip() for b in bodies_raw if str(b).strip()])
        for item in bodies_raw[:3]:
            b = _format_single_xhs_body(str(item or ""))
            if b:
                formatted_bodies.append(b)
    if not formatted_bodies and single_body:
        formatted_bodies = [single_body]
        if raw_bodies_count == 0:
            raw_bodies_count = 1
    formatted_bodies = _expand_bodies_to_three(formatted_bodies, titles[:3], single_body)
    primary_body = formatted_bodies[0] if formatted_bodies else single_body or titles[0]
    interaction_single = str(pack.get("interaction") or "").strip()
    formatted_interactions: list[str] = []
    interactions_raw = pack.get("interactions")
    if isinstance(interactions_raw, list):
        formatted_interactions = [str(x).strip() for x in interactions_raw if str(x).strip()]
    if not formatted_interactions and interaction_single:
        formatted_interactions = [interaction_single]
    formatted_interactions = _expand_interactions_to_three(formatted_interactions, interaction_single)
    return {
        "titles": titles[:3],
        "body": primary_body,
        "bodies": formatted_bodies[:3],
        "_rawBodiesCount": raw_bodies_count or len(formatted_bodies),
        "hashtags": hashtags,
        "interactions": formatted_interactions[:3],
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
    content = deliverable.get("content") if isinstance(deliverable.get("content"), dict) else {}
    count_errors = _xhs_title_body_count_errors(content)
    if count_errors:
        raise ValueError("validation_failed:" + "|".join(count_errors[:4]))
    bodies_errors = _xhs_bodies_count_errors(content)
    if bodies_errors:
        raise ValueError("validation_failed:" + "|".join(bodies_errors[:2]))
    hook_errors = _xhs_opening_hook_errors(content)
    if hook_errors:
        raise ValueError("validation_failed:" + "|".join(hook_errors[:2]))
    anchor_errors = _xhs_corpus_anchor_errors(content, used_rag=used_rag)
    if anchor_errors:
        raise ValueError("validation_failed:" + "|".join(anchor_errors[:2]))
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

    intake_raw = payload.get("intake") if isinstance(payload.get("intake"), dict) else {}
    intake = _ensure_intake_from_task(intake_raw, task_sentence)
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
    writer_instructions = _compose_expert_writer_instructions(
        task_sentence=task_sentence, intake=intake, used_rag=used_rag
    )
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
        "正文分段，每段不超过80字",
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
            count_errors = _xhs_title_body_count_errors(content)
            if count_errors and attempt < max_attempts - 1:
                last_errors = count_errors
                persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
                retry_note = "【重试】标题数量与正文分点须一致（如标题写3个坑则正文恰好3条）。"
                persona["otherRequirements"] = f"{persona.get('otherRequirements') or ''}\n{retry_note}"[:1600]
                options["persona"] = persona
                if on_progress:
                    on_progress("标题与正文条数不一致，正在重写…", 72.0)
                continue
            titles = content.get("titles") if isinstance(content.get("titles"), list) else []
            title_count = len([str(t).strip() for t in titles if str(t).strip()])
            if title_count < 3 and attempt < max_attempts - 1:
                last_errors = [f"titles 须恰好 3 个备选，当前 {title_count} 个"]
                persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
                retry_note = "【重试】titles 数组须恰好 3 个备选标题（痛点/好奇/数字型）。"
                persona["otherRequirements"] = f"{persona.get('otherRequirements') or ''}\n{retry_note}"[:1600]
                options["persona"] = persona
                if on_progress:
                    on_progress("标题备选不足，正在补全…", 73.0)
                continue
            bodies_errors = _xhs_bodies_need_retry(content)
            if bodies_errors and attempt < max_attempts - 1:
                last_errors = bodies_errors
                persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
                retry_note = "【重试】bodies 须恰好 3 个正文变体，与 titles 痛点/好奇/数字方向一一对应。"
                persona["otherRequirements"] = f"{persona.get('otherRequirements') or ''}\n{retry_note}"[:1600]
                options["persona"] = persona
                if on_progress:
                    on_progress("正文变体不足，正在补全…", 73.5)
                continue
            hook_errors = _xhs_opening_hook_errors(content)
            if hook_errors and attempt < max_attempts - 1:
                last_errors = hook_errors
                persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
                retry_note = "【重试】开头前两行须有痛点问句/具体场景/数字结果，禁止空泛铺垫。"
                persona["otherRequirements"] = f"{persona.get('otherRequirements') or ''}\n{retry_note}"[:1600]
                options["persona"] = persona
                if on_progress:
                    on_progress("开头钩子偏弱，正在强化…", 74.0)
                continue
            anchor_errors = _xhs_corpus_anchor_errors(content, used_rag=used_rag)
            if anchor_errors and attempt < max_attempts - 1:
                last_errors = anchor_errors
                persona = options.get("persona") if isinstance(options.get("persona"), dict) else {}
                retry_note = "【重试】正文须含 1～2 处资料细节，用「资料中提到」或 [资料1] 标注。"
                persona["otherRequirements"] = f"{persona.get('otherRequirements') or ''}\n{retry_note}"[:1600]
                options["persona"] = persona
                if on_progress:
                    on_progress("资料锚点不足，正在补强…", 76.0)
                continue
            if on_progress:
                on_progress("内容成品就绪", 100.0)
            if isinstance(content, dict):
                content.pop("_rawBodiesCount", None)
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
