"""多资料问答：corpus 模式判定（轻量，无 DB/Redis 依赖）。"""
from __future__ import annotations

import os

from .note_chapters import COMPARE_QUERY_RE
from .note_long_doc import is_long_doc


def per_note_min_sources() -> int:
    try:
        return max(2, min(16, int(os.getenv("NOTES_ASK_PER_NOTE_MIN_SOURCES", "4") or "4")))
    except (TypeError, ValueError):
        return 4


def detect_corpus_mode(note_ids: list[str], question: str, *, total_chars: int = 0) -> str:
    """single | multi_compare | multi_synthesize | per_note"""
    q = (question or "").strip()
    if len(note_ids) < 2:
        return "single"
    if COMPARE_QUERY_RE.search(q):
        return "multi_compare"
    synth_keys = ("综述", "总结", "概括", "整体", "全书", "所有资料", "对比分析", "综合")
    if any(k in q for k in synth_keys):
        return "multi_synthesize"
    if len(note_ids) >= per_note_min_sources():
        return "per_note"
    if is_long_doc(total_chars):
        return "per_note"
    return "multi_synthesize"
