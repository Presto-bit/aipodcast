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
    is_ask_only,
    reply_for_blocking,
    route_studio_agent,
    should_force_compose,
)
from .router_context import build_planner_user_blob
from .studio_constants import STUDIO_PLANNER_REPLY_MAX_CHARS
from .studio_revise_scope import parse_revise_scope_from_llm
from .studio_planner_utils import (
    apply_explicit_goal_tool,
    assumptions_imply_local_revise,
    assumptions_imply_new_draft,
    has_compose_write_intent,
    is_new_draft_intent,
    merge_planner_domain_format,
    normalize_planner_domain,
    normalize_planner_format,
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
    domain: str = ""
    format: str = ""
    assumptions: tuple[str, ...] = ()
    revise_blocks: tuple[str, ...] = ()
    revise_intent: str = ""
    revise_tier: str = "rephrase"
    full_rewrite: bool = False


def _format_turns_for_router(turns: list[dict[str, Any]], *, limit: int = 8) -> str:
    from .router_context import format_turns_for_planner

    return format_turns_for_planner(turns, limit=limit)


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


def _parse_assumptions(llm: dict[str, Any]) -> tuple[str, ...]:
    raw = llm.get("assumptions")
    if not isinstance(raw, list):
        return ()
    return tuple(str(a).strip()[:80] for a in raw if str(a).strip())[:5]


def _planner_meta_from_llm(
    llm: dict[str, Any],
    *,
    hint_domain: str,
    hint_format: str,
    task_sentence: str,
    message: str,
) -> tuple[str, str, tuple[str, ...]]:
    assumptions = _parse_assumptions(llm)
    domain, fmt = merge_planner_domain_format(
        llm_domain=str(llm.get("domain") or ""),
        llm_format=str(llm.get("format") or ""),
        hint_domain=hint_domain,
        hint_format=hint_format,
        task_sentence=task_sentence,
        message=message,
    )
    return domain, fmt, assumptions


def _revise_scope_fields(
    llm: dict[str, Any],
    *,
    message: str,
    selection_snippet: str = "",
    tier_override: str = "",
) -> tuple[tuple[str, ...], str, str, bool]:
    scope = parse_revise_scope_from_llm(
        llm,
        message=message,
        selection_snippet=selection_snippet,
        tier_override=tier_override,
    )
    blocks = tuple(str(b) for b in (scope.get("blocks") or []) if str(b).strip())
    intent = str(scope.get("intent") or "").strip()
    tier = str(scope.get("tier") or "rephrase").strip()
    full_rewrite = bool(scope.get("fullRewrite"))
    return blocks, intent, tier, full_rewrite


def _reconcile_decision(
    *,
    rule: StudioToolDecision,
    llm: dict[str, Any],
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    force_compose: bool = False,
    hint_domain: str = "",
    hint_format: str = "",
    explicit_goal: str = "",
    selection_snippet: str = "",
    tier_override: str = "",
) -> StudioToolDecision:
    """Planner-first：LLM 为主，规则仅做安全护栏。"""
    compose_brief = _compose_brief_for_route(turns, message)
    domain, fmt, assumptions = _planner_meta_from_llm(
        llm,
        hint_domain=hint_domain,
        hint_format=hint_format,
        task_sentence=compose_brief,
        message=message,
    )
    revise_blocks, revise_intent, revise_tier, full_rewrite = _revise_scope_fields(
        llm, message=message, selection_snippet=selection_snippet, tier_override=tier_override
    )

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
            domain=domain,
            format=fmt,
            assumptions=assumptions,
        )

    llm_tool = str(llm.get("tool") or "reply").strip().lower()
    if llm_tool not in ("reply", "compose", "revise"):
        llm_tool = "reply"
    llm_brief = str(llm.get("brief") or "").strip()
    llm_reply = str(llm.get("reply") or "").strip()[:STUDIO_PLANNER_REPLY_MAX_CHARS]
    llm_reason = str(llm.get("reason") or "").strip()[:120]

    if status == "generating":
        return StudioToolDecision(
            tool="reply",
            brief="",
            reply_text=llm_reply,
            source="mixed",
            reason="护栏：生成中仅 reply",
            domain=domain,
            format=fmt,
            assumptions=assumptions,
        )

    if version_count == 0 and llm_tool == "revise":
        llm_tool = "compose" if has_compose_write_intent(message, compose_brief) else "reply"

    write_intent = has_compose_write_intent(message, compose_brief)
    new_draft = is_new_draft_intent(message) or assumptions_imply_new_draft(assumptions)
    local_revise = assumptions_imply_local_revise(assumptions)

    if is_ask_only(message, has_manuscript=version_count > 0) and not write_intent:
        llm_tool = "reply"
    elif version_count == 0 and llm_tool == "reply" and write_intent:
        llm_tool = "compose"
        llm_reason = llm_reason or "护栏：写稿意图强制 compose"

    if version_count > 0 and llm_tool == "compose" and not new_draft:
        llm_tool = "revise"
    if version_count > 0 and new_draft and not local_revise:
        llm_tool = "compose"
        llm_reason = llm_reason or "护栏：新稿意图"
    if llm_tool == "revise" and (full_rewrite or new_draft):
        llm_tool = "compose"
        llm_reason = llm_reason or "护栏：全稿重写走 compose"

    tool: StudioTool = apply_explicit_goal_tool(llm_tool, explicit_goal)
    source: RouteSource = "llm"
    reason = llm_reason or f"LLM：{tool}"

    if (
        rule.tool == "reply"
        and tool == "compose"
        and is_ask_only(message, has_manuscript=version_count > 0)
        and not write_intent
    ):
        tool = "reply"
        source = "mixed"
        reason = "护栏：纯问答禁止成稿"

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
            domain=domain,
            format=fmt,
            assumptions=assumptions,
            revise_blocks=revise_blocks,
            revise_intent=revise_intent,
            revise_tier=revise_tier,
            full_rewrite=full_rewrite,
        )

    brief = _sanitize_brief(turns=turns, current_message=message, llm_brief=llm_brief)
    if tool == "compose" and not brief.strip():
        brief = build_compose_task_sentence(turns, current_message=message)
    if tool == "revise" and not brief.strip():
        brief = str(message).strip() or compose_brief
    return StudioToolDecision(
        tool=tool,
        brief=brief,
        reply_text="",
        source=source,
        reason=reason,
        domain=domain,
        format=fmt,
        assumptions=assumptions,
        revise_blocks=revise_blocks,
        revise_intent=revise_intent,
        revise_tier=revise_tier,
        full_rewrite=full_rewrite,
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
    manuscript_excerpt: str = "",
    has_pending_patch: bool = False,
    domain: str = "",
    fmt: str = "",
    selection_snippet: str = "",
    notebook: str = "",
    note_ids: list[str] | None = None,
    feature_summary: str = "",
    explicit_goal: str = "",
    work_brief: str = "",
    revise_tier: str = "",
) -> StudioToolDecision:
    """Planner-first fallback：LLM 失败时用规则，有稿模糊默认 reply。"""
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

    user = build_planner_user_blob(
        message=message,
        status=status,
        version_count=version_count,
        turns=turns,
        agent_mode=mode,
        manuscript_excerpt=manuscript_excerpt,
        has_pending_patch=has_pending_patch,
        domain=domain,
        fmt=fmt,
        selection_snippet=selection_snippet,
        notebook=notebook,
        note_ids=note_ids or [],
        feature_summary=feature_summary,
        explicit_goal=explicit_goal,
        work_brief=work_brief,
    )
    try:
        raw, _ = invoke_social_llm(_router_system_prompt(mode), user, max_tokens=360)
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
            hint_domain=domain,
            hint_format=fmt,
            explicit_goal=explicit_goal,
            selection_snippet=selection_snippet,
            tier_override=revise_tier,
        )
        return _apply_mode_guard(decision, agent_mode=mode, message=message)
    except Exception:
        return rule
