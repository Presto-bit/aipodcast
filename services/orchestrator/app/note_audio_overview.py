"""音频概览：用 L0 + 片摘要构建播客脚本上下文（不做全文 RAG）。"""
from __future__ import annotations

import os
from typing import Any

from .models import get_note_by_id
from .note_notebook_digest import _metadata_dict
from .note_shards import list_shards


def audio_overview_use_summaries_only() -> bool:
    return (os.getenv("AUDIO_OVERVIEW_USE_SHARD_SUMMARIES_ONLY", "1") or "1").strip().lower() not in (
        "0",
        "false",
        "off",
    )


def target_minutes_default() -> int:
    try:
        return max(5, min(30, int(os.getenv("AUDIO_OVERVIEW_TARGET_MINUTES", "10") or "10")))
    except (TypeError, ValueError):
        return 10


def build_audio_overview_context(
    note_ids: list[str],
    *,
    user_ref: str | None,
    focus: str = "",
    max_chars: int | None = None,
) -> tuple[str, dict[str, Any]]:
    cap = max_chars
    if cap is None:
        mins = target_minutes_default()
        cap = mins * 650 * 4
    cap = max(12_000, min(120_000, cap))

    parts: list[str] = []
    meta: dict[str, Any] = {"notes": len(note_ids), "mode": "audio_overview"}
    if focus.strip():
        parts.append(f"## 听众关注点\n\n{focus.strip()[:800]}")

    for nid in note_ids:
        row = get_note_by_id(nid, user_ref=user_ref)
        if not row:
            continue
        md = _metadata_dict(row)
        title = str(md.get("title") or nid).strip()
        l0 = str(md.get("bookSummaryL0") or row.get("note_summary") or "").strip()
        block = [f"## 资料：{title}"]
        if l0:
            block.append(f"### 全书概览\n\n{l0[:6000]}")
        shards = list_shards(nid)
        for sh in shards:
            st = str(sh.get("summary_text") or "").strip()
            if not st:
                continue
            stitle = str(sh.get("title") or sh.get("shard_id") or "")
            block.append(f"### {stitle}\n\n{st[:800]}")
        if len(block) > 1:
            parts.append("\n\n".join(block))

    text = "\n\n---\n\n".join(parts).strip()[:cap]
    if not text:
        return "", {"error": "no_summaries", **meta}
    meta["chars"] = len(text)
    return text, meta
