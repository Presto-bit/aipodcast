"""Studio 制品生命周期：与 work.status / versions / pendingPatch 解耦的决策输入。"""
from __future__ import annotations

from typing import Literal

StudioLifecycle = Literal["empty", "running", "committed", "reviewing"]


def derive_studio_lifecycle(
    *,
    status: str,
    version_count: int,
    has_pending_patch: bool = False,
) -> StudioLifecycle:
    if status == "generating":
        return "running"
    if version_count > 0:
        return "reviewing" if has_pending_patch else "committed"
    if has_pending_patch:
        return "reviewing"
    return "empty"


def has_committed_manuscript(version_count: int) -> bool:
    return version_count > 0
