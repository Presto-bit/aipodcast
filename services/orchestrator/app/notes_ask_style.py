"""知识库问答：题型识别、动态检索量、分层 system 与可选 Planner。"""
from __future__ import annotations

import json
import os
import re
from typing import Any

# 与 notes_ask 中历史默认一致，作为动态 top_k 的上限
_TOP_K_CAP_DEFAULT = 56

_ANSWER_TYPES = ("yesno", "concept", "howto", "compare", "survey", "general")

_TOP_K_BY_TYPE: dict[str, int] = {
    "yesno": 18,
    "concept": 22,
    "howto": 32,
    "compare": 36,
    "general": 28,
    "survey": 48,
}

_SYSTEM_CORE = (
    "你是资料助手。仅依据用户提供的摘录作答；材料不足时明确说明「材料中未提及」或「摘录中看不到」，不要编造。\n"
    "使用中文与 GitHub 风格 Markdown。\n"
    "先用 1～3 句给出可直接使用的结论、判断或最小可执行一步，再分节展开；"
    "按论证组织正文，**不要**按来源顺序逐条复述「材料里有什么」。\n"
    "角标仅用 [1]、[2]…，与【来源清单】序号一致；在论点块末标注，勿逐句标注；"
    "勿用「该书/该笔记认为」式归因，勿复述 chunk、score、noteId 等技术词；文末勿再列来源清单。\n"
    "不要输出内心推理过程。"
)

_STYLE_HINTS: dict[str, str] = {
    "yesno": "【本题】先明确是/否/视条件，再给 2～4 条依据要点。",
    "concept": "【本题】一句话定义 → 关键属性要点 → 必要时与易混项区分。",
    "howto": "【本题】首段给可执行结论或第一步 → 有序步骤（每步可附一句目的）→ 注意边界。",
    "compare": "【本题】一句比较标准 → 表格或分栏对比 → 材料范围内的选用结论。",
    "survey": "【本题】用 ## 分 3～5 个主题小节综合多源，每节先结论再要点，避免堆砌摘录标题。",
    "general": "【本题】因果或并列要点用列表；较长时用 ## 分节，小节名贴合问题用语。",
}

_PLANNER_SYSTEM = (
    "你是资料问答规划器。根据用户问题与【来源清单】（仅标题，无正文），"
    "输出一个 JSON 对象，不要 markdown 围栏、不要 JSON 外文字。\n"
    '结构：{"answerType":"yesno|concept|howto|compare|survey|general",'
    '"thesis":"1～2 句拟写开篇结论（须可在后续摘录中核对）",'
    '"sections":[{"title":"小节标题","focus":"该节应回答什么"}]}\n'
    "sections 2～4 项；短问可 1～2 项。answerType 与问题形态一致即可。"
)


def _top_k_cap() -> int:
    try:
        return max(24, min(160, int(os.getenv("NOTES_ASK_TOP_K", str(_TOP_K_CAP_DEFAULT)) or str(_TOP_K_CAP_DEFAULT))))
    except (TypeError, ValueError):
        return _TOP_K_CAP_DEFAULT


def dynamic_top_k_enabled() -> bool:
    return (os.getenv("NOTES_ASK_DYNAMIC_TOP_K", "1") or "").strip().lower() not in ("0", "false", "no")


def merge_adjacent_chunks_enabled() -> bool:
    return (os.getenv("NOTES_ASK_MERGE_ADJACENT_CHUNKS", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def two_phase_planner_enabled() -> bool:
    return (os.getenv("NOTES_ASK_TWO_PHASE", "0") or "").strip().lower() in ("1", "true", "yes", "on")


def followups_enabled() -> bool:
    return (os.getenv("NOTES_ASK_FOLLOWUPS", "1") or "").strip().lower() not in ("0", "false", "no")


def followup_min_answer_chars() -> int:
    try:
        return max(0, int(os.getenv("NOTES_ASK_FOLLOWUP_MIN_ANSWER_CHARS", "40") or "40"))
    except (TypeError, ValueError):
        return 40


def followup_max_chars() -> int:
    try:
        return max(16, min(80, int(os.getenv("NOTES_ASK_FOLLOWUP_MAX_CHARS", "48") or "48")))
    except (TypeError, ValueError):
        return 48


def notes_ask_temperature() -> float:
    try:
        return max(0.1, min(1.0, float(os.getenv("NOTES_ASK_TEMPERATURE", "0.6") or "0.6")))
    except (TypeError, ValueError):
        return 0.6


def notes_ask_max_output_tokens() -> int:
    try:
        return max(512, min(8192, int(os.getenv("NOTES_ASK_MAX_OUTPUT_TOKENS", "4096") or "4096")))
    except (TypeError, ValueError):
        return 4096


def classify_answer_type(question: str) -> str:
    q = (question or "").strip()
    if not q:
        return "general"
    if len(q) <= 14 and re.search(
        r"^(是|否|有没有|能否|可不可以|是否|对吗|对不对)",
        q,
        re.I,
    ):
        return "yesno"
    if re.search(r"(对比|区别|差异|vs\.?|VS|哪个好|选型|优缺点|孰优)", q, re.I):
        return "compare"
    if re.search(r"(全面|梳理|总结|综述|一览|架构|体系|通读|整体)", q):
        return "survey"
    if re.search(r"(怎么|如何|步骤|流程|操作|配置|实现|安装|排查)", q):
        return "howto"
    if re.search(r"(是什么|什么是|定义|含义|概念|指什么)", q):
        return "concept"
    if re.search(r"(吗|？|\?)\s*$", q) and len(q) <= 40:
        return "yesno"
    return "general"


def resolve_retrieval_top_k(question: str, answer_type: str | None = None) -> tuple[int, str]:
    """返回 (top_k, answer_type)。"""
    at = (answer_type or "").strip().lower()
    if at not in _TOP_K_BY_TYPE:
        at = classify_answer_type(question)
    cap = _top_k_cap()
    if not dynamic_top_k_enabled():
        return cap, at
    base = _TOP_K_BY_TYPE.get(at, _TOP_K_BY_TYPE["general"])
    return max(16, min(cap, base)), at


def build_notes_ask_system_prompt(answer_type: str) -> str:
    t = answer_type if answer_type in _STYLE_HINTS else "general"
    hint = _STYLE_HINTS[t]
    return f"{_SYSTEM_CORE}\n{hint}"


def build_notes_ask_user_preamble() -> str:
    return "资料摘录如下：\n\n"


def build_planner_messages(*, manifest_block: str, question: str) -> list[dict[str, str]]:
    q = (question or "").strip()
    user = f"{manifest_block}\n\n---\n\n用户问题：{q}"
    return [
        {"role": "system", "content": _PLANNER_SYSTEM},
        {"role": "user", "content": user},
    ]


def parse_planner_json(raw: str) -> dict[str, Any] | None:
    s = (raw or "").strip()
    if not s:
        return None
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2 and lines[0].startswith("```"):
            s = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()
    brace = s.find("{")
    if brace < 0:
        return None
    depth = 0
    end = -1
    for i, ch in enumerate(s[brace:], start=brace):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end <= brace:
        return None
    try:
        data = json.loads(s[brace:end])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    at = str(data.get("answerType") or data.get("answer_type") or "").strip().lower()
    if at not in _ANSWER_TYPES:
        at = classify_answer_type(str(data.get("question") or ""))
    thesis = str(data.get("thesis") or "").strip()[:400]
    sections_raw = data.get("sections")
    sections: list[dict[str, str]] = []
    if isinstance(sections_raw, list):
        for item in sections_raw[:6]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()[:80]
            focus = str(item.get("focus") or "").strip()[:200]
            if title or focus:
                sections.append({"title": title or "要点", "focus": focus})
    if not thesis and not sections:
        return None
    return {"answerType": at, "thesis": thesis, "sections": sections}


def merge_adjacent_retrieval_picks(
    picked: list[tuple[float, dict[str, Any]]],
) -> list[tuple[float, dict[str, Any]]]:
    """同笔记相邻 chunk_index 合并为一段，减少碎片摘录头。"""
    if not picked:
        return picked
    merged: list[tuple[float, dict[str, Any]]] = []
    for score, row in picked:
        r = dict(row)
        nid = str(r.get("note_id") or "")
        idx = int(r.get("chunk_index") or 0)
        ch = str(r.get("chunk_text") or "").strip()
        if not ch:
            continue
        if merged:
            prev_score, prev = merged[-1]
            pnid = str(prev.get("note_id") or "")
            prev_end = int(prev.get("_chunk_index_end") or prev.get("chunk_index") or 0)
            if pnid == nid and prev_end + 1 == idx:
                prev["chunk_text"] = (str(prev.get("chunk_text") or "").rstrip() + "\n\n" + ch).strip()
                prev["_chunk_index_end"] = idx
                merged[-1] = (max(prev_score, score), prev)
                continue
        r["_chunk_index_end"] = idx
        merged.append((score, r))
    return merged


def parse_followup_json(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2 and lines[0].startswith("```"):
            s = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()
    brace = s.find("{")
    if brace >= 0:
        depth = 0
        end = -1
        for i, ch in enumerate(s[brace:], start=brace):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end > brace:
            s = s[brace:end]
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return ""
    if not isinstance(data, dict):
        return ""
    q = str(data.get("followUpQuestion") or data.get("follow_up_question") or "").strip()
    return q[: followup_max_chars()]


def format_planner_block(plan: dict[str, Any]) -> str:
    at = str(plan.get("answerType") or "general")
    thesis = str(plan.get("thesis") or "").strip()
    lines = [
        "【写作计划】（据此组织正文，事实仍须来自下方摘录）",
        f"题型：{at}",
    ]
    if thesis:
        lines.append(f"开篇方向：{thesis}")
    for i, sec in enumerate(plan.get("sections") or [], start=1):
        if not isinstance(sec, dict):
            continue
        title = str(sec.get("title") or "").strip()
        focus = str(sec.get("focus") or "").strip()
        if title or focus:
            lines.append(f"{i}. {title} — {focus}".strip(" —"))
    return "\n".join(lines)
