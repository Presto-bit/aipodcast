"""Studio 单 Agent：结构化 tool 路由（LLM 分类 + 规则护栏）。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

from ..social_llm_utils import invoke_social_llm, parse_json_object
from .agent_tool_schema import (
    normalize_agent_mode,
    parse_tool_call,
    tool_router_system_prompt,
)
from .agent_route import (
    build_compose_task_sentence,
    build_task_sentence_from_turns,
    is_ask_only,
    is_insufficient_brief,
    reply_for_blocking,
    route_studio_agent,
    should_force_compose,
)

StudioTool = Literal["reply", "compose", "revise"]
StudioAgentMode = Literal["ask", "write"]
RouteSource = Literal["rules", "llm", "mixed"]


@dataclass(frozen=True)
class StudioToolDecision:
    tool: StudioTool
    brief: str
    reply_text: str
    source: RouteSource
    reason: str


def _format_turns_for_router(turns: list[dict[str, Any]], *, limit: int = 8) -> str:
    lines: list[str] = []
    for t in turns[-limit:]:
        role = str(t.get("role") or "").strip()
        if role not in ("user", "assistant"):
            continue
        text = str(t.get("content") or "").strip()
        if not text:
            continue
        label = "用户" if role == "user" else "助手"
        lines.append(f"{label}：{text[:400]}")
    return "\n".join(lines) if lines else "（无历史）"


def _router_system_prompt(agent_mode: StudioAgentMode) -> str:
    return tool_router_system_prompt(agent_mode=agent_mode)


def _parse_router_response(raw: str) -> dict[str, Any] | None:
    try:
        parsed = parse_json_object(raw)
    except ValueError:
        return None
    return parse_tool_call(parsed if isinstance(parsed, dict) else None)


def _sanitize_brief(
    *,
    turns: list[dict[str, Any]],
    current_message: str,
    llm_brief: str,
) -> str:
    rule_brief = build_compose_task_sentence(turns, current_message=current_message)
    candidate = llm_brief.strip()
    if not candidate:
        return rule_brief
    if is_ask_only(candidate, has_manuscript=False):
        return rule_brief
    if "钩子怎么写" in candidate or "开头钩子写法" in candidate:
        return rule_brief
    if len(candidate) < 8:
        return rule_brief
    return candidate[:2000]


def _compose_brief_for_route(turns: list[dict[str, Any]], message: str) -> str:
    return build_compose_task_sentence(turns, current_message=message)


def _rule_decision(
    *,
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    force_compose: bool = False,
) -> StudioToolDecision:
    compose_brief = _compose_brief_for_route(turns, message)
    if should_force_compose(
        message=message,
        task_sentence=compose_brief,
        version_count=version_count,
        force_compose=force_compose,
    ):
        return StudioToolDecision(
            tool="compose",
            brief=compose_brief[:2000],
            reply_text="",
            source="rules",
            reason="规则：chip 强制成稿",
        )
    tool = route_studio_agent(
        message=message,
        status=status,
        version_count=version_count,
        task_sentence=compose_brief,
    )
    if tool == "reply":
        reply_text = ""
        reason = "规则：问答/澄清"
        if version_count == 0 and not compose_brief.strip() and len(message.strip()) < 8:
            reply_text = reply_for_blocking(compose_brief or message)
            reason = "规则：信息过少，追问"
        return StudioToolDecision(
            tool="reply",
            brief="",
            reply_text=reply_text,
            source="rules",
            reason=reason,
        )

    brief = (
        compose_brief
        if tool == "compose"
        else (str(message).strip() or compose_brief)
    )
    return StudioToolDecision(
        tool=tool,
        brief=brief[:2000],
        reply_text="",
        source="rules",
        reason=f"规则：{tool}",
    )


def _reconcile_decision(
    *,
    rule: StudioToolDecision,
    llm: dict[str, Any],
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    force_compose: bool = False,
) -> StudioToolDecision:
    compose_brief = _compose_brief_for_route(turns, message)
    if should_force_compose(
        message=message,
        task_sentence=compose_brief,
        version_count=version_count,
        force_compose=force_compose,
    ):
        return StudioToolDecision(
            tool="compose",
            brief=compose_brief[:2000],
            reply_text="",
            source="rules",
            reason="规则：chip 强制成稿",
        )
    llm_tool = str(llm.get("tool") or "reply").strip().lower()
    if llm_tool not in ("reply", "compose", "revise"):
        llm_tool = "reply"
    llm_brief = str(llm.get("brief") or "").strip()
    llm_reply = str(llm.get("reply") or "").strip()[:480]

    if status == "generating":
        return StudioToolDecision(
            tool="reply",
            brief="",
            reply_text=llm_reply,
            source="mixed",
            reason="护栏：生成中仅 reply",
        )

    if version_count == 0 and llm_tool == "revise":
        llm_tool = "compose" if not is_ask_only(message, has_manuscript=False) else "reply"

    if is_ask_only(message, has_manuscript=version_count > 0):
        llm_tool = "reply"

    if (
        version_count > 0
        and status in ("ready", "shipped")
        and rule.tool == "revise"
        and not is_ask_only(message, has_manuscript=True)
    ):
        llm_tool = "revise"

    tool: StudioTool = llm_tool
    source: RouteSource = "llm"
    reason = f"LLM：{tool}"

    if rule.tool == "compose" and llm_tool == "reply" and not is_ask_only(message, has_manuscript=version_count > 0):
        tool = "compose"
        source = "mixed"
        reason = "规则+LLM：open-ended 成稿"

    if rule.tool == "compose" and tool == "reply" and not is_ask_only(
        message, has_manuscript=version_count > 0
    ):
        tool = "compose"
        source = "mixed"
        reason = "规则：强制成稿"

    if rule.tool == "reply" and llm_tool == "compose" and is_ask_only(message):
        tool = "reply"
        source = "mixed"
        reason = "护栏：纯问答禁止成稿"

    if (
        version_count > 0
        and status in ("ready", "shipped")
        and rule.tool == "revise"
        and not is_ask_only(message, has_manuscript=True)
        and tool in ("reply", "compose")
    ):
        tool = "revise"
        source = "mixed"
        reason = "护栏：有稿禁止降为 reply/compose"

    if rule.tool == tool:
        source = "mixed" if source == "llm" else "rules"

    if tool == "reply":
        reply_text = llm_reply or rule.reply_text
        return StudioToolDecision(
            tool="reply",
            brief="",
            reply_text=reply_text,
            source=source,
            reason=reason,
        )

    brief = _sanitize_brief(turns=turns, current_message=message, llm_brief=llm_brief)
    if tool == "compose" and not brief.strip():
        brief = build_compose_task_sentence(turns, current_message=message)
    return StudioToolDecision(
        tool=tool,
        brief=brief,
        reply_text="",
        source=source,
        reason=reason,
    )


def _apply_mode_guard(
    decision: StudioToolDecision,
    *,
    agent_mode: StudioAgentMode,
    message: str,
) -> StudioToolDecision:
    if agent_mode != "ask" or decision.tool == "reply":
        return decision
    hint = decision.reply_text.strip()
    if not hint:
        hint = "已切换为问答模式，不会改动画布。若要写稿请切到「写稿」模式。"
    return StudioToolDecision(
        tool="reply",
        brief="",
        reply_text=hint,
        source="mixed",
        reason="模式：问答仅 reply",
    )


def resolve_studio_agent_tool(
    *,
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    agent_mode: str = "write",
    force_compose: bool = False,
) -> StudioToolDecision:
    """单 loop 结构化 tool：LLM tool_call + 规则护栏 + 显式模式。"""
    mode = normalize_agent_mode(agent_mode)
    rule = _rule_decision(
        message=message,
        status=status,
        version_count=version_count,
        turns=turns,
        force_compose=force_compose,
    )
    if mode == "ask":
        return _apply_mode_guard(rule, agent_mode=mode, message=message)

    if os.getenv("STUDIO_TOOL_ROUTER_LLM", "1").strip() in ("0", "false", "no"):
        return rule

    user = "\n".join(
        [
            f"作品状态：{status}",
            f"是否已有稿件：{'是' if version_count > 0 else '否'}",
            f"用户模式：{mode}",
            "",
            "近期对话：",
            _format_turns_for_router(turns),
            "",
            f"用户最新一句：{message.strip()[:800]}",
        ]
    )
    try:
        raw, _ = invoke_social_llm(_router_system_prompt(mode), user, max_tokens=320)
        parsed = _parse_router_response(str(raw or ""))
        if not parsed:
            return rule
        decision = _reconcile_decision(
            rule=rule,
            llm=parsed,
            message=message,
            status=status,
            version_count=version_count,
            turns=turns,
            force_compose=force_compose,
        )
        return _apply_mode_guard(decision, agent_mode=mode, message=message)
    except Exception:
        return rule
