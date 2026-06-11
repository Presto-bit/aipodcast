"""首页 Composer 专家模式 — intake 推断（规则 + 可选轻量 LLM）。"""
from __future__ import annotations

import json
import re
from typing import Any

from ..provider_router import deepseek_text_config_ok, invoke_llm_chat_messages_deepseek_only

EXPERT_META: dict[str, dict[str, str]] = {
    "xhs_ops": {
        "persona": "平台原生笔记操盘手，擅长可复制发布的笔记包，不编造数据",
        "methodology": "受众 → 语气与长度 → 标题策略 → 正文结构 → 话题",
        "toolchain": "资料 RAG（可选）· 红书模板 Job · 通识兜底（无资料时）",
    },
    "mp_ops": {
        "persona": "长文与转发结构顾问，擅长公众号可读性与转发语",
        "methodology": "文体 → 结构 → 摘要/钩子 → 成稿",
        "toolchain": "资料 RAG（可选）· 公号模板 Job · 通识兜底",
    },
    "voice_gen": {
        "persona": "短视频口播编剧，擅长抓人开头与口播节奏",
        "methodology": "时长 → 平台 → 钩子 → 分镜稿",
        "toolchain": "资料 RAG（可选）· 脚本 Job · 通识兜底",
    },
    "podcast_plan": {
        "persona": "播客节目策划，擅长结构与 shownotes",
        "methodology": "形态 → 时长 → 深度 → 大纲/脚本",
        "toolchain": "资料 RAG（可选）· 脚本 Job · 通识兜底",
    },
}

_XHS_LENGTH_CHARS = {"short": 400, "medium": 600, "long": 1200}
_XHS_PARA_MAX = {"short": 80, "medium": 100, "long": 120}


def resolve_xhs_intake_length(intake: dict[str, Any], task_sentence: str = "") -> str:
    """从 intake 或任务句推断篇幅档位 short/medium/long。"""
    existing = str(intake.get("length") or "").strip()
    if existing in _XHS_LENGTH_CHARS:
        return existing
    note = str(intake.get("userNote") or "")
    text = f"{task_sentence} {note}"
    m = re.search(r"(?:写|约|到|至少)\s*(\d{3,4})\s*字", text)
    if m:
        n = int(m.group(1))
        if n >= 800:
            return "long"
        if n >= 450:
            return "medium"
        return "short"
    if re.search(r"长文|长篇|详尽|1000字|800字|扩写", text):
        return "long"
    if re.search(r"短篇|精简|短帖|250字", text):
        return "short"
    return "medium"


def xhs_body_para_max_chars(length: str) -> int:
    return _XHS_PARA_MAX.get(str(length or "").strip(), 88)


XHS_STEP0_FIELDS = [
    {
        "fieldId": "accountStage",
        "prompt": "账号阶段（决定语气与 CTA 力度）",
        "multi": False,
        "options": [
            {"id": "cold_start", "label": "新号起号，需要快速建立认知"},
            {"id": "steady", "label": "稳定更新，巩固垂类标签"},
            {"id": "convert", "label": "已有粉丝，重点转化/变现"},
            {"id": "brand", "label": "品牌/企业号，偏官方可信"},
        ],
    },
    {
        "fieldId": "audience",
        "prompt": "理想读者是谁？他们此刻最愁什么",
        "multi": True,
        "minSelect": 1,
        "options": [
            {"id": "newcomer", "label": "刚入门的小白/新人"},
            {"id": "peers", "label": "同行/从业者（要专业深度）"},
            {"id": "buyer", "label": "有购买/决策意向的用户"},
            {"id": "general", "label": "泛流量/路人（要3秒钩子）"},
        ],
        "allowOther": True,
    },
    {
        "fieldId": "contentAngle",
        "prompt": "内容切入角度",
        "multi": False,
        "options": [
            {"id": "review", "label": "测评种草（真实体验+优缺点）"},
            {"id": "tutorial", "label": "教程/SOP（步骤可照做）"},
            {"id": "listicle", "label": "避坑清单/盘点（收藏向）"},
            {"id": "story", "label": "经历故事（情绪共鸣）"},
            {"id": "opinion", "label": "观点态度（有立场、敢判断）"},
        ],
    },
    {
        "fieldId": "publishGoal",
        "prompt": "这篇发出去，你最想达成什么",
        "multi": True,
        "minSelect": 1,
        "options": [
            {"id": "expose", "label": "曝光破圈、进推荐"},
            {"id": "save", "label": "高收藏（干货/清单）"},
            {"id": "comment", "label": "评论互动、要反馈"},
            {"id": "dm", "label": "引导私信/咨询"},
            {"id": "follow", "label": "涨粉关注"},
        ],
    },
]

XHS_STEP1_FIELDS = [
    {
        "fieldId": "hookStyle",
        "prompt": "开头钩子类型（前 3 秒/第一屏）",
        "multi": False,
        "options": [
            {"id": "pain_question", "label": "痛点提问（你是不是也…）"},
            {"id": "number", "label": "数字/结果先行（3步/7天/省50%）"},
            {"id": "contrast", "label": "反常识/对比（别再…/原来…）"},
            {"id": "scene", "label": "场景代入（打工人/宝妈/深夜…）"},
        ],
    },
    {
        "fieldId": "structure",
        "prompt": "正文结构偏好",
        "multi": False,
        "options": [
            {"id": "bullet", "label": "分点清单（· / ①②③）"},
            {"id": "steps", "label": "步骤教程（先后逻辑）"},
            {"id": "story_arc", "label": "故事线（背景→转折→收获）"},
            {"id": "compare", "label": "对比测评（A vs B / 前后）"},
        ],
    },
    {
        "fieldId": "tone",
        "prompt": "整体语气",
        "multi": False,
        "options": [
            {"id": "casual", "label": "口语亲切（像朋友聊天）"},
            {"id": "pro", "label": "专业克制（有依据、少夸张）"},
            {"id": "sharp", "label": "观点鲜明（敢下判断）"},
        ],
    },
    {
        "fieldId": "length",
        "prompt": "正文篇幅（不含标题与话题）",
        "multi": False,
        "options": [
            {"id": "short", "label": "短（约 250 字内，快刷向）"},
            {"id": "medium", "label": "中（250–500 字，主流笔记）"},
            {"id": "long", "label": "长（500 字以上，深度收藏）"},
        ],
    },
]

XHS_STEP2_FIELDS = [
    {
        "fieldId": "titleCount",
        "prompt": "备选标题数量",
        "multi": False,
        "options": [
            {"id": "1", "label": "1 个（已定稿）"},
            {"id": "3", "label": "3 个（A/B 测点击）"},
            {"id": "5", "label": "5 个（多方向试）"},
        ],
    },
    {
        "fieldId": "withHashtags",
        "prompt": "话题 tag 策略",
        "multi": False,
        "options": [
            {"id": "yes", "label": "要带（垂类+流量词组合）"},
            {"id": "no", "label": "不要（靠内容自然流量）"},
        ],
    },
    {
        "fieldId": "ctaStyle",
        "prompt": "结尾行动引导",
        "multi": False,
        "options": [
            {"id": "save", "label": "求收藏（干货向）"},
            {"id": "comment", "label": "求评论/讨论"},
            {"id": "soft_dm", "label": "软引导私信（不硬广）"},
            {"id": "none", "label": "弱 CTA（自然结束）"},
        ],
    },
    {
        "fieldId": "visualStyle",
        "prompt": "配图/封面风格",
        "multi": False,
        "options": [
            {"id": "big_type", "label": "大字报封面 + 要点内页"},
            {"id": "photo", "label": "实拍/场景图为主"},
            {"id": "screenshot", "label": "截图标注/对比图"},
            {"id": "infographic", "label": "信息图/流程图"},
        ],
    },
]

INTAKE_STEPS: dict[str, list[dict[str, Any]]] = {
    "xhs_ops": [
        {"step": 0, "theme": "读者与内容定位", "fields": XHS_STEP0_FIELDS},
        {"step": 1, "theme": "结构与表达", "fields": XHS_STEP1_FIELDS},
        {"step": 2, "theme": "发布与视觉", "fields": XHS_STEP2_FIELDS},
    ],
    "mp_ops": [
        {
            "step": 0,
            "theme": "文体与结构",
            "fields": [
                {
                    "fieldId": "genre",
                    "prompt": "文体",
                    "multi": False,
                    "options": [
                        {"id": "opinion", "label": "观点文"},
                        {"id": "tutorial", "label": "教程体"},
                        {"id": "news", "label": "资讯解读"},
                    ],
                }
            ],
        }
    ],
}


def _infer_xhs(task_sentence: str) -> tuple[dict[str, Any], bool, str | None]:
    text = task_sentence.strip()
    lower = text.lower()
    intake: dict[str, Any] = {}
    hint: str | None = None

    audience: list[str] = []
    if re.search(r"新人|小白|入门|初学者", text):
        audience.append("newcomer")
    if re.search(r"同行|从业者|内行|产品经理|运营", text):
        audience.append("peers")
    if re.search(r"购买|下单|种草|测评", text):
        audience.append("buyer")
    if not audience:
        audience.append("general")
    intake["audience"] = audience

    if re.search(r"品牌|官方|企业", text):
        intake["accountStage"] = "brand"
    elif re.search(r"变现|转化|私信", text):
        intake["accountStage"] = "convert"
    elif re.search(r"起号|新号|从0", text):
        intake["accountStage"] = "cold_start"
    else:
        intake["accountStage"] = "steady"

    if re.search(r"推广|种草|带货", text):
        intake["contentAngle"] = "story"
        intake["noteType"] = "story"
    elif re.search(r"清单|list|几条|几点|避坑", text, re.I):
        intake["contentAngle"] = "listicle"
        intake["noteType"] = "listicle"
    elif re.search(r"故事|经历|复盘", text):
        intake["contentAngle"] = "story"
        intake["noteType"] = "story"
    elif re.search(r"测评|对比|优缺点", text):
        intake["contentAngle"] = "review"
        intake["noteType"] = "howto"
    elif re.search(r"观点|认为|其实", text):
        intake["contentAngle"] = "opinion"
        intake["noteType"] = "howto"
    else:
        intake["contentAngle"] = "tutorial"
        intake["noteType"] = "howto"

    goals: list[str] = []
    if re.search(r"收藏|干货|清单", text):
        goals.append("save")
    if re.search(r"评论|互动|讨论", text):
        goals.append("comment")
    if re.search(r"私信|咨询|联系", text):
        goals.append("dm")
    if re.search(r"涨粉|关注", text):
        goals.append("follow")
    if not goals:
        goals.append("expose")
    intake["publishGoal"] = goals
    intake["purpose"] = ["retain"] if re.search(r"复盘|总结|回顾", text) else ["acquire"]

    if re.search(r"数字|\d+步|\d+天", text):
        intake["hookStyle"] = "number"
    elif re.search(r"场景|打工人|深夜", text):
        intake["hookStyle"] = "scene"
    else:
        intake["hookStyle"] = "pain_question"

    angle = str(intake.get("contentAngle") or "")
    if angle == "listicle":
        intake["structure"] = "bullet"
    elif angle == "story":
        intake["structure"] = "story_arc"
    elif angle == "review":
        intake["structure"] = "compare"
    else:
        intake["structure"] = "steps"

    if re.search(r"口语|亲切|随意", text):
        intake["tone"] = "casual"
    elif re.search(r"专业|严谨", text):
        intake["tone"] = "pro"
    else:
        intake["tone"] = "casual"

    intake["length"] = resolve_xhs_intake_length(intake, text)
    intake["titleCount"] = "3"
    intake["withHashtags"] = "yes" if re.search(r"tag|话题|#", lower) else "yes"
    if re.search(r"私信", text):
        intake["ctaStyle"] = "soft_dm"
    elif re.search(r"评论", text):
        intake["ctaStyle"] = "comment"
    else:
        intake["ctaStyle"] = "save"
    intake["visualStyle"] = "screenshot" if re.search(r"截图|标注", text) else "big_type"

    if intake.get("contentAngle") == "story" and "peers" in audience:
        hint = "同行+经历故事更适合深度案例体，建议选中篇"

    skip_step2 = len(text) >= 32 and bool(intake.get("tone")) and bool(intake.get("contentAngle"))
    return intake, skip_step2, hint


def _maybe_llm_refine(
    expert_id: str,
    task_sentence: str,
    rule_intake: dict[str, Any],
) -> dict[str, Any] | None:
    if not deepseek_text_config_ok():
        return None
    system = (
        "你是创作专家 intake 助手。根据用户任务句，输出 JSON 对象："
        '{"preselected":{字段id:值或数组},"skipStep2":boolean,"hint":"可选一句中文提示"}。'
        "只输出 JSON，不要 markdown。"
    )
    user = json.dumps(
        {"expertId": expert_id, "taskSentence": task_sentence, "ruleDraft": rule_intake},
        ensure_ascii=False,
    )
    try:
        raw, _ = invoke_llm_chat_messages_deepseek_only(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.2,
            timeout_sec=30,
            max_tokens=512,
        )
        parsed = json.loads(raw.strip())
        if isinstance(parsed.get("preselected"), dict):
            return parsed
    except Exception:
        return None
    return None


def _attach_preselected(fields: list[dict[str, Any]], intake: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for field in fields:
        fid = str(field.get("fieldId") or "")
        val = intake.get(fid)
        pre: list[str] = []
        if isinstance(val, list):
            pre = [str(x) for x in val if str(x).strip()]
        elif isinstance(val, str) and val.strip():
            pre = [val.strip()]
        row = dict(field)
        row["preselected"] = pre
        out.append(row)
    return out


def run_composer_expert_intake(body: dict[str, Any]) -> dict[str, Any]:
    expert_id = str(body.get("expertId") or "").strip()
    if expert_id not in EXPERT_META:
        raise ValueError("invalid_expert_id")

    task_sentence = str(body.get("taskSentence") or "").strip()
    if not task_sentence:
        raise ValueError("task_sentence_required")

    try:
        step_index = int(body.get("intakeStep") or 0)
    except (TypeError, ValueError):
        step_index = 0
    step_index = max(0, step_index)

    steps = INTAKE_STEPS.get(expert_id) or INTAKE_STEPS["xhs_ops"]
    if step_index >= len(steps):
        step_index = len(steps) - 1

    current_intake = body.get("intake") if isinstance(body.get("intake"), dict) else {}
    hint: str | None = None
    skip_step2 = False

    if expert_id == "xhs_ops" and step_index == 0 and not current_intake:
        rule_intake, skip_step2, hint = _infer_xhs(task_sentence)
        llm_pack = _maybe_llm_refine(expert_id, task_sentence, rule_intake)
        if isinstance(llm_pack, dict):
            merged = dict(rule_intake)
            pre = llm_pack.get("preselected")
            if isinstance(pre, dict):
                merged.update(pre)
            skip_step2 = bool(llm_pack.get("skipStep2", skip_step2))
            hint = str(llm_pack.get("hint") or hint or "").strip() or hint
        current_intake = {**rule_intake, **current_intake}
    elif expert_id == "xhs_ops" and not current_intake:
        current_intake, skip_step2, hint = _infer_xhs(task_sentence)

    step_def = steps[step_index]
    fields = _attach_preselected(list(step_def.get("fields") or []), current_intake)
    if hint and fields:
        fields[0] = {**fields[0], "hint": hint}

    meta = EXPERT_META[expert_id]
    return {
        "expertStrip": {
            "kind": "expert_strip",
            "persona": meta["persona"],
            "methodology": meta["methodology"],
            "toolchain": meta["toolchain"],
        },
        "intakeStep": {
            "kind": "intake_step",
            "step": step_index + 1,
            "total": len(steps),
            "theme": str(step_def.get("theme") or ""),
            "fields": fields,
        },
        "preselected": current_intake,
        "skipStep2": skip_step2,
        "hint": hint,
    }
