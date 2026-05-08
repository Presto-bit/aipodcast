"""剪辑主轨合并调度：重排后防抖异步合并；上传/删除等仍即时合并。"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from .clip_audio_merge_job import run_clip_audio_merge_sync

logger = logging.getLogger(__name__)

DEBOUNCE_MS = int(os.getenv("CLIP_MERGE_DEBOUNCE_MS", "1200"))

_project_locks: dict[str, asyncio.Lock] = {}
_debounce_tasks: dict[str, asyncio.Task[Any]] = {}


def _lock(project_id: str) -> asyncio.Lock:
    if project_id not in _project_locks:
        _project_locks[project_id] = asyncio.Lock()
    return _project_locks[project_id]


async def execute_merge_locked(project_id: str, uid: str | None) -> None:
    lock = _lock(project_id)
    async with lock:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, run_clip_audio_merge_sync, project_id, uid)


async def merge_immediate(project_id: str, uid: str | None) -> None:
    """取消未完成防抖任务，立即合并（stage / remove / 手动 merge）。"""
    old = _debounce_tasks.pop(project_id, None)
    if old and not old.done():
        old.cancel()
        try:
            await old
        except asyncio.CancelledError:
            pass

    from .clip_store import set_clip_audio_merge_state

    set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="queued", error=None)
    await execute_merge_locked(project_id, uid)


async def schedule_merge_after_reorder(project_id: str, uid: str | None) -> None:
    """分段顺序调整后：标记队列并防抖触发合并。"""
    from .clip_store import set_clip_audio_merge_state

    set_clip_audio_merge_state(project_id=project_id, user_uuid=uid, status="queued", error=None)

    old = _debounce_tasks.pop(project_id, None)
    if old and not old.done():
        old.cancel()
        try:
            await old
        except asyncio.CancelledError:
            pass

    async def debounced() -> None:
        try:
            await asyncio.sleep(max(0.05, DEBOUNCE_MS / 1000.0))
            await execute_merge_locked(project_id, uid)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("debounced clip merge task failed project_id=%s", project_id)
        finally:
            _debounce_tasks.pop(project_id, None)

    t = asyncio.create_task(debounced())
    _debounce_tasks[project_id] = t
