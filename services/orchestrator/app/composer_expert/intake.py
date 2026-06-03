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

XHS_STEP0_FIELDS = [
    {
        "fieldId": "audience",
        "prompt": "主要写给谁看？",
        "multi": True,
        "minSelect": 1,
        "options": [
            {"id": "newcomer", "label": "产品/行业新人"},
            {"id": "peers", "label": "同行从业者"},
            {"id": "general", "label": "泛用户/路人"},
        ],
        "allowOther": True,
    },
    {
        "fieldId": "noteType",
        "prompt": "笔记类型",
        "multi": False,
        "options": [
            {"id": "howto", "label": "干货教程"},
            {"id": "story", "label": "故事经历"},
            {"id": "listicle", "label": "清单体"},
        ],
    },
    {
        "fieldId": "purpose",
        "prompt": "这次主要目的",
        "multi": True,
        "minSelect": 1,
        "options": [
            {"id": "acquire", "label": "获客拉新"},
            {"id": "retain", "label": "复盘沉淀"},
            {"id": "brand", "label": "建立个人品牌"},
        ],
    },
]

XHS_STEP1_FIELDS = [
    {
        "fieldId": "tone",
        "prompt": "语气",
        "multi": False,
        "options": [
            {"id": "casual", "label": "口语亲切"},
            {"id": "pro", "label": "专业克制"},
            {"id": "sharp", "label": "观点鲜明"},
        ],
    },
    {
        "fieldId": "length",
        "prompt": "正文长度",
        "multi": False,
        "options": [
            {"id": "short", "label": "短（约 300 字内）"},
            {"id": "medium", "label": "中（约 300–600 字）"},
            {"id": "long", "label": "长（600 字以上）"},
        ],
    },
    {
        "fieldId": "titleCount",
        "prompt": "标题数量",
        "multi": False,
        "options": [
            {"id": "1", "label": "1 个"},
            {"id": "3", "label": "3 个"},
            {"id": "5", "label": "5 个"},
        ],
    },
    {
        "fieldId": "withHashtags",
        "prompt": "是否带话题 tag",
        "multi": False,
        "options": [
            {"id": "yes", "label": "要带话题"},
            {"id": "no", "label": "不要话题"},
        ],
    },
]

INTAKE_STEPS: dict[str, list[dict[str, Any]]] = {
    "xhs_ops": [
        {"step": 0, "theme": "受众与目的", "fields": XHS_STEP0_FIELDS},
        {"step": 1, "theme": "语气与形式", "fields": XHS_STEP1_FIELDS},
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
    if not audience:
        audience.append("general")
    intake["audience"] = audience

    if re.search(r"清单|list|几条|几点", text, re.I):
        intake["noteType"] = "listicle"
    elif re.search(r"故事|经历|复盘", text):
        intake["noteType"] = "story"
    else:
        intake["noteType"] = "howto"

    intake["purpose"] = ["retain"] if re.search(r"复盘|总结|回顾", text) else ["acquire"]

    if re.search(r"口语|亲切|随意", text):
        intake["tone"] = "casual"
    elif re.search(r"专业|严谨", text):
        intake["tone"] = "pro"
    else:
        intake["tone"] = "casual"

    intake["length"] = "short" if re.search(r"短|60\s*秒|精简", text) else "medium"
    intake["titleCount"] = "3"
    intake["withHashtags"] = "yes" if re.search(r"tag|话题|#", lower) else "yes"

    if intake.get("noteType") == "story" and "peers" in audience:
        hint = "选「同行+故事/复盘」更适合深度案例体"

    skip_step2 = len(text) >= 24 and bool(intake.get("tone"))
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
