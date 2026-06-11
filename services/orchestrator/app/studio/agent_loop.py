"""Studio Agent tool loop（单 Planner + 护栏，P2 收敛）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from .agent_tool_router import resolve_studio_agent_tool
from .studio_constants import STUDIO_MANUSCRIPT_EXCERPT_CHARS
from .studio_planner_utils import explicit_goal_from_payload

LoopTool = Literal["read_manuscript", "reply", "compose", "revise"]
StepStatus = Literal["pending", "running", "done", "error"]

EmitStep = Callable[[str, str, StepStatus, str | None], None]


@dataclass
class AgentLoopResult:
    decision: Any
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


def _payload_domain(payload: dict[str, Any]) -> tuple[str, str]:
    return str(payload.get("domain") or "").strip(), str(payload.get("format") or "").strip()


def _feature_summary(payload: dict[str, Any]) -> str:
    feature_core = payload.get("featureCore") if isinstance(payload.get("featureCore"), dict) else {}
    return " · ".join(
        str(feature_core.get(k) or "").strip()
        for k in ("who", "remember", "avoid")
        if str(feature_core.get(k) or "").strip()
    )[:80]


def _note_ids(payload: dict[str, Any]) -> list[str]:
    raw = payload.get("noteIds") or payload.get("selected_note_ids") or []
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def run_agent_tool_loop(
    *,
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    payload: dict[str, Any],
    emit_step: EmitStep | None = None,
) -> AgentLoopResult:
    domain, fmt = _payload_domain(payload)
    manuscript_excerpt = manuscript_plain_from_payload(payload)
    has_pending_patch = bool(payload.get("pendingPatch"))
    notebook = str(payload.get("notebook") or payload.get("notes_notebook") or "").strip()
    selection_snippet = str(payload.get("selectionSnippet") or "").strip()

    _emit(emit_step, "understand", "理解你的指令", "running", None)
    decision = resolve_studio_agent_tool(
        message=message,
        status=status,
        version_count=version_count,
        turns=turns,
        agent_mode=str(payload.get("agentMode") or payload.get("agent_mode") or "write"),
        force_compose=bool(payload.get("forceCompose")),
        manuscript_excerpt=manuscript_excerpt,
        has_pending_patch=has_pending_patch,
        domain=domain,
        fmt=fmt,
        selection_snippet=selection_snippet,
        notebook=notebook,
        note_ids=_note_ids(payload),
        feature_summary=_feature_summary(payload),
        explicit_goal=explicit_goal_from_payload(payload),
        work_brief=str(payload.get("workBrief") or payload.get("brief") or "").strip(),
        revise_tier=str(payload.get("reviseTier") or "").strip(),
    )
    _emit(emit_step, "understand", "理解你的指令", "done", decision.tool)
    _emit(emit_step, "route", "决定下一步", "done", decision.tool)
    return AgentLoopResult(decision=decision, manuscript_excerpt=manuscript_excerpt)
