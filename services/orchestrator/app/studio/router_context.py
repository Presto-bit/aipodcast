"""Studio Planner 标准上下文块（单 Agent 路由）。"""
from __future__ import annotations

from typing import Any

from .agent_route import build_compose_task_sentence
from .lifecycle import derive_studio_lifecycle
from .studio_constants import STUDIO_MANUSCRIPT_EXCERPT_CHARS


def format_turns_for_planner(turns: list[dict[str, Any]], *, limit: int = 8) -> str:
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


def build_planner_user_blob(
    *,
    message: str,
    status: str,
    version_count: int,
    turns: list[dict[str, Any]],
    agent_mode: str,
    manuscript_excerpt: str = "",
    has_pending_patch: bool = False,
    domain: str = "",
    fmt: str = "",
    selection_snippet: str = "",
) -> str:
    lifecycle = derive_studio_lifecycle(
        status=status,
        version_count=version_count,
        has_pending_patch=has_pending_patch,
    )
    task_sentence = build_compose_task_sentence(turns, current_message=message)
    chunks = [
        f"【作品】status={status} lifecycle={lifecycle} versions={version_count}",
        f"【模式】{agent_mode}",
    ]
    if domain.strip():
        chunks.append(f"【领域】domain={domain.strip()[:32]} format={fmt.strip()[:32]}")
    if task_sentence.strip():
        chunks.append(f"【任务句】{task_sentence[:1200]}")
    if manuscript_excerpt.strip():
        chunks.extend(["【当前稿件】", manuscript_excerpt.strip()[:STUDIO_MANUSCRIPT_EXCERPT_CHARS]])
    if selection_snippet.strip():
        chunks.extend(["【选区】", selection_snippet.strip()[:600]])
    chunks.extend(
        [
            "",
            "【近期对话】",
            format_turns_for_planner(turns),
            "",
            f"【用户最新】{message.strip()[:800]}",
        ]
    )
    return "\n".join(chunks)
