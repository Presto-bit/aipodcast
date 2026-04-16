"""由转写词表 + excluded 推导精剪时间线（保留段 / 多轨占位）。"""

from __future__ import annotations

import json
import uuid
from typing import Any


def _words_from_normalized(norm: Any) -> list[dict[str, Any]]:
    if isinstance(norm, str):
        try:
            norm = json.loads(norm)
        except Exception:
            norm = {}
    if not isinstance(norm, dict):
        return []
    wl = norm.get("words") or []
    return [w for w in wl if isinstance(w, dict)]


def build_timeline_v1_from_row(row: dict[str, Any], excluded: set[str] | None = None) -> dict[str, Any]:
    """
    返回 timeline_json 结构：
    version, tracks[speech 保留片段 | music 空轨占位].
    """
    ex = excluded if excluded is not None else set()
    if not ex and row.get("excluded_word_ids") is not None:
        raw = row.get("excluded_word_ids")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = []
        if isinstance(raw, list):
            ex = {str(x).strip() for x in raw if str(x).strip()}
    words = _words_from_normalized(row.get("transcript_normalized"))
    ordered = sorted(words, key=lambda w: int(w.get("s_ms") or 0))
    clips: list[dict[str, Any]] = []
    cur_ids: list[str] = []
    cur_start: int | None = None
    cur_end: int | None = None

    def flush() -> None:
        nonlocal cur_ids, cur_start, cur_end, clips
        if not cur_ids or cur_start is None or cur_end is None:
            cur_ids = []
            cur_start = None
            cur_end = None
            return
        clips.append(
            {
                "id": str(uuid.uuid4())[:12],
                "start_ms": int(cur_start),
                "end_ms": int(cur_end),
                "source": "transcript",
                "word_ids": cur_ids[:800],
            }
        )
        cur_ids = []
        cur_start = None
        cur_end = None

    for w in ordered:
        wid = str(w.get("id") or "").strip()
        if not wid:
            continue
        try:
            s = int(w.get("s_ms") or 0)
            e = int(w.get("e_ms") or 0)
        except (TypeError, ValueError):
            s, e = 0, 0
        if wid in ex:
            flush()
            continue
        if cur_start is None:
            cur_start = s
        cur_end = e if cur_end is None else max(int(cur_end), e)
        cur_ids.append(wid)
    flush()

    return {
        "version": 1,
        "generated_at": "server",
        "tracks": [
            {"id": "speech", "kind": "speech", "label": "口播", "clips": clips},
            {"id": "music", "kind": "music", "label": "音乐（占位）", "clips": []},
        ],
    }
