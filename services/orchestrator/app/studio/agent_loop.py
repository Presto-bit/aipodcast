"""Studio Agent 多轮 tool loop（read_manuscript → reply | compose | revise）。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from ..social_llm_utils import invoke_social_llm, parse_json_object
from .agent_route import build_compose_task_sentence, is_ask_only
from .agent_tool_router import StudioToolDecision, _apply_mode_guard, _reconcile_decision, _rule_decision
from .agent_tool_schema import normalize_agent_mode, tool_router_system_prompt
from .router_context import build_planner_user_blob
from .studio_constants import STUDIO_MANUSCRIPT_EXCERPT_CHARS

LoopTool = Literal["read_manuscript", "reply", "compose", "revise"]
StepStatus = Literal["pending", "running", "done", "error"]

EmitStep = Callable[[str, str, StepStatus, str | None], None]

MAX_LOOP_ROUNDS = 3

LOCAL_PATCH_SIGNAL = "【块级改版·局部】"
BLOCK_PATCH_SIGNAL = "【块级改版】"


@dataclass
class AgentLoopResult:
    decision: StudioToolDecision
    manuscript_excerpt: str = ""
    steps: list[dict[str, str]] = field(default_factory=list)


def _emit(emit: EmitStep | None, step_id: str, label: str, status: StepStatus, tool: str | None = None) -> None:
    if emit:
        emit(step_id, label, status, tool)


def manuscript_plain_from_payload(
    payload: dict[str, Any], *, max_chars: int = STUDIO_MANUSCRIPT_EXCERPT_CHARS
) -> str:
    blocks = payload.get("manuscriptBlocks") if isinstance(payload.get("manuscriptBlocks"), list) else []
    if not blocks:
        return ""
    parts: list[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        kind = str(block.get("kind") or "").strip()
        if kind == "title":
            text = str(block.get("text") or "").strip()
            if text:
                parts.append(f"标题：{text}")
        elif kind == "body":
            text = str(block.get("text") or "").strip()
            if text:
                parts.append(text)
        elif kind == "hashtags":
            tags = block.get("tags")
            if isinstance(tags, list):
                line = " ".join(f"#{str(t).lstrip('#')}" for t in tags if str(t).strip())
                if line:
                    parts.append(f"话题：{line}")
        elif kind == "coverBrief":
            text = str(block.get("text") or "").strip()
            if text:
                parts.append(f"封面：{text}")
    text = "\n\n".join(parts).strip()
    return text[:max_chars]


def _loop_planner_system(*, agent_mode: str, has_manuscript: bool, manuscript_already_read: bool) -> str:
    base = tool_router_system_prompt(agent_mode="ask" if agent_mode == "ask" else "write")
    read_rule = (
        "- 已有稿件且需解读/改版对比时，可先 tool=read_manuscript（仅一次）。"
        if has_manuscript and not manuscript_already_read
        else "- 禁止 read_manuscript（已读过或无稿件）。"
    )
    return "\n".join(
        [
            base,
            "",
            "loop 扩展：",
            read_rule,
            '- 输出 JSON 须含 "tool" 字段；可选 read_manuscript 后再选 reply|compose|revise。',
            "只输出 JSON。",
        ]
    )


def _parse_loop_tool(raw: str) -> dict[str, Any] | None:
    try:
        parsed = parse_json_object(raw)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    tool = str(parsed.get("tool") or "").strip().lower()
    if tool not in ("read_manuscript", "reply", "compose", "revise"):
        return None
    return parsed


def _route_step_label(tool: str) -> str:
    if tool == "compose":
        return "开始写稿"
    if tool == "revise":
        return "开始改版"
    return "准备回复"


def _payload_domain(payload: dict[str, Any]) -> tuple[str, str]:
    domain = str(payload.get("domain") or "").strip()
    fmt = str(payload.get("format") or "").strip()
    return domain, fmt


def run_agent_tool_loop(
    *,
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    payload: dict[str, Any],
    emit_step: EmitStep | None = None,
) -> AgentLoopResult:
    agent_mode = normalize_agent_mode(str(payload.get("agentMode") or payload.get("agent_mode") or "write"))
    steps: list[dict[str, str]] = []
    has_pending_patch = bool(payload.get("pendingPatch"))
    domain, fmt = _payload_domain(payload)
    selection = str(payload.get("selectionSnippet") or "").strip()

    _emit(emit_step, "understand", "理解你的指令", "running", None)

    if LOCAL_PATCH_SIGNAL in message or BLOCK_PATCH_SIGNAL in message:
        _emit(emit_step, "understand", "理解你的指令", "done", "revise")
        _emit(emit_step, "route", "选区改版", "done", "revise")
        brief = build_compose_task_sentence(turns, current_message=message)
        decision = StudioToolDecision(
            tool="revise",
            brief=brief[:2000],
            reply_text="",
            source="rules",
            reason="选区改版",
        )
        decision = _apply_mode_guard(decision, agent_mode=agent_mode, message=message)
        return AgentLoopResult(decision=decision, steps=steps)

    rule = _rule_decision(
        message=message,
        status=status,
        version_count=version_count,
        turns=turns,
        force_compose=bool(payload.get("forceCompose")),
    )
    if agent_mode == "ask":
        decision = _apply_mode_guard(rule, agent_mode=agent_mode, message=message)
        _emit(emit_step, "understand", "理解你的指令", "done", "reply")
        _emit(emit_step, "route", "问答回复", "done", "reply")
        return AgentLoopResult(decision=decision, steps=steps)

    manuscript_excerpt = manuscript_plain_from_payload(payload)
    has_ms = version_count > 0 or bool(manuscript_excerpt)
    manuscript_read = bool(manuscript_excerpt)
    llm_parsed: dict[str, Any] | None = None

    use_llm_loop = os.getenv("STUDIO_TOOL_ROUTER_LLM", "1").strip() not in ("0", "false", "no")

    if use_llm_loop:
        for round_idx in range(MAX_LOOP_ROUNDS):
            _emit(
                emit_step,
                f"plan_{round_idx}",
                "规划下一步" if round_idx else "选择工具",
                "running",
                None,
            )
            try:
                raw, _ = invoke_social_llm(
                    _loop_planner_system(
                        agent_mode=agent_mode,
                        has_manuscript=has_ms,
                        manuscript_already_read=manuscript_read,
                    ),
                    build_planner_user_blob(
                        message=message,
                        status=status,
                        version_count=version_count,
                        turns=turns,
                        agent_mode=agent_mode,
                        manuscript_excerpt=manuscript_excerpt,
                        has_pending_patch=has_pending_patch,
                        domain=domain,
                        fmt=fmt,
                        selection_snippet=selection,
                    ),
                    max_tokens=360,
                )
                llm_parsed = _parse_loop_tool(str(raw or ""))
            except Exception:
                llm_parsed = None
                break

            if not llm_parsed:
                break

            tool = str(llm_parsed.get("tool") or "").strip().lower()
            _emit(emit_step, f"plan_{round_idx}", "选择工具", "done", tool)

            if tool == "read_manuscript" and not manuscript_read:
                _emit(emit_step, "read_manuscript", "读取当前稿件", "running", "read_manuscript")
                manuscript_excerpt = manuscript_plain_from_payload(payload)
                if not manuscript_excerpt:
                    manuscript_excerpt = str(payload.get("taskSentence") or "")[:2000]
                manuscript_read = True
                _emit(emit_step, "read_manuscript", "读取当前稿件", "done", "read_manuscript")
                continue

            if tool in ("reply", "compose", "revise"):
                break
        else:
            llm_parsed = None

    _emit(emit_step, "understand", "理解你的指令", "done", None)

    if llm_parsed and str(llm_parsed.get("tool") or "") in ("reply", "compose", "revise"):
        decision = _reconcile_decision(
            rule=rule,
            llm=llm_parsed,
            message=message,
            status=status,
            version_count=version_count,
            turns=turns,
            force_compose=bool(payload.get("forceCompose")),
        )
        decision = _apply_mode_guard(decision, agent_mode=agent_mode, message=message)
        _emit(emit_step, "route", _route_step_label(decision.tool), "done", decision.tool)
        return AgentLoopResult(
            decision=decision,
            manuscript_excerpt=manuscript_excerpt,
            steps=steps,
        )

    from .agent_tool_router import resolve_studio_agent_tool

    decision = resolve_studio_agent_tool(
        message=message,
        status=status,
        version_count=version_count,
        turns=turns,
        agent_mode=agent_mode,
        force_compose=bool(payload.get("forceCompose")),
        manuscript_excerpt=manuscript_excerpt,
        has_pending_patch=has_pending_patch,
        domain=domain,
        fmt=fmt,
        selection_snippet=selection,
    )
    _emit(
        emit_step,
        "route",
        _route_step_label(decision.tool),
        "done",
        decision.tool,
    )
    return AgentLoopResult(decision=decision, manuscript_excerpt=manuscript_excerpt, steps=steps)
