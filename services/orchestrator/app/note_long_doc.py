"""长文资料：阈值、索引块上限伸缩、问答预算与 Planner 开关。"""
from __future__ import annotations

import os

from .note_constants import LONG_DOC_IMPORT_WARN_CHARS


def long_doc_routing_threshold() -> int:
    """超过该字数启用片路由、主动 on-demand、默认两阶段 Planner 等。"""
    try:
        return max(50_000, int(os.getenv("NOTES_ASK_LONG_DOC_CHARS", "200000") or "200000"))
    except (TypeError, ValueError):
        return 200_000


def long_doc_warn_threshold() -> int:
    return LONG_DOC_IMPORT_WARN_CHARS


def is_long_doc(total_chars: int) -> bool:
    return int(total_chars or 0) >= long_doc_routing_threshold()


def is_very_long_doc(total_chars: int) -> bool:
    return int(total_chars or 0) >= long_doc_warn_threshold()


def proactive_on_demand_enabled() -> bool:
    return (os.getenv("NOTE_RAG_PROACTIVE_ON_DEMAND", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def two_phase_for_long_doc_enabled() -> bool:
    return (os.getenv("NOTES_ASK_TWO_PHASE_LONG_DOC", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def note_rag_abs_cap_for_body(body_chars: int) -> int:
    """按正文字数抬高向量块硬顶（在 NOTE_RAG_MAX_CHUNKS_ABS 基础上）。"""
    try:
        base = max(64, min(20_000, int(os.getenv("NOTE_RAG_MAX_CHUNKS_ABS", "512") or "512")))
    except (TypeError, ValueError):
        base = 512
    if body_chars <= 0:
        return base
    try:
        per_100k = max(0, min(256, int(os.getenv("NOTE_RAG_EXTRA_CHUNKS_PER_100K", "48") or "48")))
    except (TypeError, ValueError):
        per_100k = 48
    try:
        hard = max(base, min(20_000, int(os.getenv("NOTE_RAG_MAX_CHUNKS_ABS_HARD", "1536") or "1536")))
    except (TypeError, ValueError):
        hard = 1536
    extra = (int(body_chars) // 100_000) * per_100k
    return min(hard, base + extra)
