"""Studio Agent 意图：create / edit / converse（映射 legacy compose / revise / reply）。"""
from __future__ import annotations

from typing import Literal

from .agent_route import (
    TOPIC_FORM_SIGNAL,
    WRITE_INTENT,
    is_ask_only,
    is_explicit_ask_while_ready,
    is_manuscript_edit,
    is_manuscript_read_intent,
    should_force_compose,
)
from .lifecycle import StudioLifecycle, derive_studio_lifecycle, has_committed_manuscript

StudioAgentAction = Literal["create", "edit", "converse"]
LegacyStudioTool = Literal["compose", "revise", "reply"]


def action_to_legacy_tool(action: StudioAgentAction) -> LegacyStudioTool:
    return {"create": "compose", "edit": "revise", "converse": "reply"}[action]


def legacy_tool_to_action(tool: str) -> StudioAgentAction:
    t = str(tool or "").strip().lower()
    if t == "revise":
        return "edit"
    if t == "compose":
        return "create"
    return "converse"


def resolve_studio_action(
    *,
    message: str,
    status: str,
    version_count: int,
    task_sentence: str,
    agent_mode: str = "write",
    force_compose: bool = False,
    has_pending_patch: bool = False,
) -> StudioAgentAction:
    mode = str(agent_mode or "write").strip().lower()
    if mode == "ask":
        return "converse"

    lifecycle = derive_studio_lifecycle(
        status=status,
        version_count=version_count,
        has_pending_patch=has_pending_patch,
    )
    q = message.strip()
    has_ms = has_committed_manuscript(version_count)
    brief = task_sentence.strip() or q

    if should_force_compose(
        message=q,
        task_sentence=brief,
        version_count=version_count,
        force_compose=force_compose,
    ):
        return "create"

    if lifecycle == "running":
        if is_manuscript_read_intent(q) or is_explicit_ask_while_ready(q) or is_ask_only(q, has_manuscript=has_ms):
            return "converse"
        if has_ms and is_manuscript_edit(q, has_manuscript=True):
            return "edit"
        if WRITE_INTENT.search(q) or (TOPIC_FORM_SIGNAL.search(q) and not is_ask_only(q, has_manuscript=has_ms)):
            return "create"
        if brief and not is_ask_only(q, has_manuscript=has_ms):
            return "create"
        return "converse"

    if has_ms:
        if is_explicit_ask_while_ready(q) or is_manuscript_read_intent(q):
            return "converse"
        if is_manuscript_edit(q, has_manuscript=True):
            return "edit"
        return "converse"

    if is_ask_only(q, has_manuscript=has_ms):
        return "converse"

    if not has_ms and (brief or WRITE_INTENT.search(q) or TOPIC_FORM_SIGNAL.search(q) or len(q) >= 4):
        return "create"

    return "converse"


def should_create_without_manuscript(
    *,
    message: str,
    task_sentence: str,
    version_count: int,
    status: str = "draft",
) -> bool:
    if version_count > 0:
        return False
    return (
        resolve_studio_action(
            message=message,
            status=status,
            version_count=version_count,
            task_sentence=task_sentence,
            agent_mode="write",
            force_compose=False,
            has_pending_patch=False,
        )
        == "create"
    )
