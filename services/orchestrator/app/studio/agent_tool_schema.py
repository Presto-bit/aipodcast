"""Studio 单 loop 结构化 tool schema（前后端对齐）。"""
from __future__ import annotations

from typing import Any, Literal

StudioAgentMode = Literal["ask", "write"]
StudioTool = Literal["reply", "compose", "revise"]

STUDIO_AGENT_TOOL_JSON_SHAPE = (
    '{"tool":"reply|compose|revise","brief":"compose/revise 任务句",'
    '"reply":"reply 时≤120字","reason":"可选，10字内"}'
)


def normalize_agent_mode(raw: str | None) -> StudioAgentMode:
    return "ask" if str(raw or "").strip().lower() == "ask" else "write"


def parse_tool_call(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    tool = str(raw.get("tool") or "").strip().lower()
    if tool not in ("reply", "compose", "revise"):
        return None
    out: dict[str, Any] = {"tool": tool}
    brief = str(raw.get("brief") or "").strip()
    reply = str(raw.get("reply") or "").strip()
    reason = str(raw.get("reason") or "").strip()
    if brief:
        out["brief"] = brief[:2000]
    if reply:
        out["reply"] = reply[:480]
    if reason:
        out["reason"] = reason[:120]
    return out


def tool_router_system_prompt(*, agent_mode: StudioAgentMode) -> str:
    mode_line = (
        "当前用户模式：问答(ask)。无论 brief 是否足够，必须 tool=reply，禁止 compose/revise。"
        if agent_mode == "ask"
        else "当前用户模式：写稿(write)。信息足够时可 compose/revise，纯问答用 reply。"
    )
    return "\n".join(
        [
            "你是小红书 Studio 的单 Agent 工具调度器。每轮用户输入只选一个 tool 并输出 JSON。",
            "只输出一个 JSON 对象，不要 markdown，不要 JSON 前后说明。",
            "",
            f"JSON 形状：{STUDIO_AGENT_TOOL_JSON_SHAPE}",
            "",
            "tool：",
            '- reply：问答、方法论、澄清缺口、解读稿件；不写完整笔记正文。',
            '- compose：写首稿（推广/种草/笔记，含受众或卖点或场景）。',
            '- revise：已有稿件且用户要改版/润色/改标题正文。',
            "",
            mode_line,
            "",
            "规则：",
            "- 只问怎么写/钩子/结构、未说要写一篇 → reply。",
            "- 推广 brief 足够 → compose；brief 仅含创作任务，不含 earlier 问答。",
            "- brief 禁止教程体（步骤拆解/同行套用/今天拆解写法）。",
            "- 无稿件禁止 revise。",
        ]
    )
