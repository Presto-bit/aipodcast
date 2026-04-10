"""笔记本相关任务的展示用元数据（与业务逻辑解耦）。"""

from __future__ import annotations

import re
from typing import Any

# 作品卡片与任务 result 中保留的引用笔记标题条数（与套餐 max_note_refs 上限对齐，便于单行截断 + 悬停看全量）
NOTES_SOURCE_TITLES_CAP = 12

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def human_note_source_label(raw: Any) -> str:
    """作品展示用：无标题或内容为 UUID 时不向用户展示技术 ID。"""
    s = str(raw or "").strip()
    if not s or _UUID_RE.match(s):
        return "未命名笔记"
    return s


def snapshot_notes_source_titles(payload: dict[str, Any]) -> list[str]:
    """
    从任务 payload 取出用于展示的引用笔记标题（与 selected_note_ids 顺序对齐，最多 NOTES_SOURCE_TITLES_CAP 条）。
    缺标题或占位为 UUID 时统一为「未命名笔记」。
    """
    ids = payload.get("selected_note_ids")
    titles = payload.get("selected_note_titles")
    out: list[str] = []
    if not isinstance(ids, list):
        if isinstance(titles, list):
            for x in titles:
                lab = human_note_source_label(x)
                out.append(lab)
                if len(out) >= NOTES_SOURCE_TITLES_CAP:
                    break
        return out[:NOTES_SOURCE_TITLES_CAP]

    for i, nid_raw in enumerate(ids):
        if len(out) >= NOTES_SOURCE_TITLES_CAP:
            break
        nid = str(nid_raw).strip()
        if not nid:
            continue
        if isinstance(titles, list) and i < len(titles):
            label = str(titles[i]).strip()
            out.append(human_note_source_label(label))
        else:
            out.append(human_note_source_label(""))
    return out
