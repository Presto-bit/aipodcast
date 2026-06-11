"""Work.brief 与 compose 任务句（稳定 brief + 本轮补充）。"""
from __future__ import annotations

from typing import Any

from .agent_route import build_compose_task_sentence, refine_compose_task_sentence


def build_compose_brief_from_work(
    *,
    work_brief: str,
    message: str,
    turns: list[dict[str, Any]],
) -> str:
    """compose 用稳定 brief + 本轮补充，不用整段对话史。"""
    stable = str(work_brief or "").strip()
    msg = str(message or "").strip()
    if stable and msg and msg not in stable:
        return refine_compose_task_sentence(f"{stable}\n\n{msg}")
    if stable:
        return refine_compose_task_sentence(stable)
    return build_compose_task_sentence(turns, current_message=message)


def build_revise_task_in_executor(
    *,
    message: str,
    manuscript_excerpt: str,
    selection_snippet: str = "",
    intent: str = "",
) -> str:
    """revise 执行器内拼 prompt（用户原话 + 稿件 + 选区）。"""
    parts = [f"改版意见：{message.strip()}"]
    if intent.strip():
        parts.append(f"意图：{intent.strip()}")
    if selection_snippet.strip():
        parts.append(f"选区：「{selection_snippet.strip()[:400]}」")
    if manuscript_excerpt.strip():
        parts.extend(["", "【当前稿件】", manuscript_excerpt.strip()[:2400]])
    parts.append("\n（在现有正文基础上修改，勿另起新篇；保留主题与结构）")
    return "\n".join(parts).strip()
