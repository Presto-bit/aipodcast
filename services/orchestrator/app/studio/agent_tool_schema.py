"""Studio V2 Planner 结构化 tool schema（前后端对齐）。"""
from __future__ import annotations

from typing import Any, Literal

from .studio_constants import STUDIO_PLANNER_REPLY_MAX_CHARS

StudioAgentMode = Literal["ask", "write"]
StudioTool = Literal["reply", "compose", "revise", "patch", "read_manuscript", "search_corpus"]

STUDIO_AGENT_TOOL_JSON_SHAPE = (
    '{"tool":"read_manuscript|search_corpus|compose|patch|reply|revise",'
    '"brief":"compose/patch 任务句","reply":"reply 可选草稿（下游按场景扩展）","reason":"必填",'
    '"domain":"social|article|business|narrative|script|academic|general",'
    '"format":"short_post|long_form|listicle|email|tutorial|script_beats|summary|general",'
    '"assumptions":["可选假设"]}'
)


def normalize_agent_mode(raw: str | None) -> StudioAgentMode:
    return "ask" if str(raw or "").strip().lower() == "ask" else "write"


def _normalize_tool(raw: str) -> str:
    t = str(raw or "").strip().lower()
    if t == "patch":
        return "revise"
    if t in ("read_manuscript", "search_corpus"):
        return "reply"
    return t


def parse_tool_call(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    tool = _normalize_tool(str(raw.get("tool") or ""))
    if tool not in ("reply", "compose", "revise"):
        return None
    out: dict[str, Any] = {"tool": tool}
    brief = str(raw.get("brief") or "").strip()
    reply = str(raw.get("reply") or "").strip()
    reason = str(raw.get("reason") or "").strip()
    domain = str(raw.get("domain") or "").strip()
    fmt = str(raw.get("format") or "").strip()
    assumptions = raw.get("assumptions")
    if brief:
        out["brief"] = brief[:2000]
    if reply:
        out["reply"] = reply[:STUDIO_PLANNER_REPLY_MAX_CHARS]
    if reason:
        out["reason"] = reason[:120]
    if domain:
        out["domain"] = domain[:32]
    if fmt:
        out["format"] = fmt[:32]
    if isinstance(assumptions, list):
        out["assumptions"] = [str(a).strip()[:80] for a in assumptions if str(a).strip()][:5]
    return out


def tool_router_system_prompt(*, agent_mode: StudioAgentMode) -> str:
    mode_line = (
        "当前用户模式：问答(ask)。无论 brief 是否足够，必须 tool=reply，禁止 compose/revise。"
        if agent_mode == "ask"
        else "当前用户模式：写稿(write)。open-ended 默认 compose；有稿局部改 → revise(patch)。"
    )
    return "\n".join(
        [
            "你是 Studio V2 的多领域写作 Planner。每轮用户输入只选一个 tool 并输出 JSON。",
            "只输出一个 JSON 对象，不要 markdown，不要 JSON 前后说明。",
            "",
            f"JSON 形状：{STUDIO_AGENT_TOOL_JSON_SHAPE}",
            "",
            "tool（revise = patch 局部改）：",
            "- reply：问答/运营/解读；reply 字段可写简短要点，完整回答由下游扩展。",
            "- compose：写首稿；缺细节由成稿模型合理假设，禁止 ask 追问 blocking。",
            "- revise：已有稿件局部改版或润色；brief 写清 scope。",
            "- read_manuscript / search_corpus：仅在 loop 内使用，对外映射 revise/reply/compose。",
            "",
            mode_line,
            "",
            "决策（禁止用句长/有无问号猜 tool）：",
            "- 运营/发布后怎么推/涨粉/发布节奏 → reply（可结合稿件给建议，不改稿）。",
            "- 总结/解读/为什么这样写 → reply。",
            "- 改标题/语气/字数/更小红书体 → revise。",
            "- 无稿 + 写稿意图 → compose。",
            "- 模糊可答可改 → reply，末尾可提示如何改版。",
            "",
            "规则：",
            "- open-ended 写稿意图 → compose；缺细节假设，勿降级 reply。",
            "- 只改标题/段落/语气 → revise，brief 注明 scope。",
            "- 推断 domain/format 写入 JSON（social/article/business/…）。",
            "- 无稿件禁止 revise。",
            "- reason 必填：用户可见 trace。",
        ]
    )
