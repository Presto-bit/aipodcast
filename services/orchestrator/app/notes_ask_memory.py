"""知识库对话记忆：会话态注入、历史按字符预算打包、检索问句扩展（用户无感）。"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from .notes_ask_routing import is_follow_up_query

_SESSION_STATE_MAX_CHARS = 1_200
_HISTORY_VERBATIM_BUDGET = 7_500
_HISTORY_PER_ROW_MAX = 2_000
_HISTORY_MAX_ROWS = 24
_SESSION_BLOCK_RESERVE = 900


def _env_int(name: str, default: int, *, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)) or str(default))))
    except (TypeError, ValueError):
        return default


def history_verbatim_budget() -> int:
    return _env_int("NOTES_ASK_HISTORY_VERBATIM_BUDGET", _HISTORY_VERBATIM_BUDGET, lo=2_000, hi=16_000)


def history_per_row_max() -> int:
    return _env_int("NOTES_ASK_HISTORY_PER_ROW_MAX", _HISTORY_PER_ROW_MAX, lo=400, hi=4_000)


def history_max_rows() -> int:
    return _env_int("NOTES_ASK_HISTORY_MAX_ROWS", _HISTORY_MAX_ROWS, lo=4, hi=48)


def session_state_max_chars() -> int:
    return _env_int("NOTES_ASK_SESSION_STATE_MAX_CHARS", _SESSION_STATE_MAX_CHARS, lo=200, hi=3_000)


def _trim_row_content(content: str) -> str:
    t = (content or "").strip()
    cap = history_per_row_max()
    if len(t) <= cap:
        return t
    head = 420
    tail = 420
    if cap < head + tail + 8:
        return t[:cap]
    return f"{t[:head]}\n…\n{t[-tail:]}"


def normalize_session_state(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw or not isinstance(raw, dict):
        return None
    if int(raw.get("v") or 0) != 1:
        return None
    topic = str(raw.get("topic") or "").strip()[:400]
    threads_in = raw.get("threads") if isinstance(raw.get("threads"), list) else []
    threads: list[dict[str, str]] = []
    for item in threads_in[:8]:
        if not isinstance(item, dict):
            continue
        about = str(item.get("about") or "").strip()[:200]
        if not about:
            continue
        tid = str(item.get("id") or "").strip()[:40] or "t0"
        status = "parked" if str(item.get("status") or "").strip().lower() == "parked" else "active"
        threads.append({"id": tid, "about": about, "status": status})
    facts = [str(x).strip()[:220] for x in (raw.get("facts") or []) if str(x).strip()][:12]
    prefs = [str(x).strip()[:120] for x in (raw.get("prefs") or []) if str(x).strip()][:6]
    try:
        turn_cursor = max(0, min(9999, int(raw.get("turnCursor") or raw.get("turn_cursor") or 0)))
    except (TypeError, ValueError):
        turn_cursor = 0
    rev_raw = raw.get("sourcesRevision") if raw.get("sourcesRevision") is not None else raw.get("sources_revision")
    sources_revision = None
    if rev_raw is not None:
        try:
            sources_revision = max(0, min(999, int(rev_raw)))
        except (TypeError, ValueError):
            sources_revision = None
    if not topic and not threads and not facts and not turn_cursor:
        return None
    out: dict[str, Any] = {
        "v": 1,
        "topic": topic,
        "threads": threads,
        "facts": facts,
        "prefs": prefs,
        "turnCursor": turn_cursor,
    }
    if sources_revision is not None:
        out["sourcesRevision"] = sources_revision
    return out


def pack_chat_history_rows(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """从最新消息向前，按字符预算选取历史行（与前端 pack 对齐）。"""
    if not rows:
        return []
    normed: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        item: dict[str, Any] = {"role": role, "content": _trim_row_content(content)}
        if role == "assistant":
            ac = row.get("activeChapters") or row.get("active_chapters")
            if isinstance(ac, list) and ac:
                item["activeChapters"] = ac[:6]
            ash = row.get("activeShards") or row.get("active_shards")
            if isinstance(ash, list) and ash:
                item["activeShards"] = ash[:6]
            tid = str(row.get("threadId") or row.get("thread_id") or "").strip()[:40]
            if tid:
                item["threadId"] = tid
        normed.append(item)

    budget = history_verbatim_budget()
    cap_rows = history_max_rows()
    packed: list[dict[str, Any]] = []
    used = 0
    for row in reversed(normed):
        if len(packed) >= cap_rows:
            break
        need = len(str(row.get("content") or ""))
        if packed and used + need > budget:
            break
        packed.insert(0, row)
        used += need
    return packed


def build_session_state_block(session_state: dict[str, Any] | None) -> str:
    st = normalize_session_state(session_state)
    if not st:
        return ""
    topic = str(st.get("topic") or "").strip()
    facts = st.get("facts") if isinstance(st.get("facts"), list) else []
    threads = st.get("threads") if isinstance(st.get("threads"), list) else []
    prefs = st.get("prefs") if isinstance(st.get("prefs"), list) else []
    lines: list[str] = []
    if topic:
        lines.append(f"当前议题：{topic}")
    active_threads = [t for t in threads if isinstance(t, dict) and str(t.get("status") or "") == "active"]
    if active_threads:
        lines.append("活跃线索：" + "；".join(str(t.get("about") or "").strip() for t in active_threads[:3] if t.get("about")))
    if facts:
        lines.append("已达成共识（须与本轮摘录核对，冲突以摘录为准）：")
        for f in facts[:8]:
            s = str(f).strip()
            if s:
                lines.append(f"- {s}")
    if prefs:
        lines.append("表达偏好：" + "；".join(str(p).strip() for p in prefs[:4] if str(p).strip()))
    rev = st.get("sourcesRevision")
    if rev is not None and int(rev) > 0:
        lines.append("用户已调整参考资料范围；涉及旧资料范围的结论须按本轮摘录重核。")
    if not lines:
        return ""
    body = "\n".join(lines)
    cap = session_state_max_chars()
    if len(body) > cap:
        body = body[: cap - 1] + "…"
    return (
        "【会话延续】以下仅为同屏对话脉络，不构成事实依据；作答事实仍以本轮资料摘录为准。\n\n" + body
    )


def build_history_verbatim_block(chat_history: list[dict[str, str]] | None) -> str:
    rows = pack_chat_history_rows(chat_history)
    if not rows:
        return ""
    normed: list[str] = []
    for row in rows:
        role = str(row.get("role") or "").strip().lower()
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        who = "用户" if role == "user" else "助手"
        normed.append(f"{who}：{content}")
    if not normed:
        return ""
    return "对话历史（仅作上下文衔接，事实依据仍以本轮资料摘录为准）：\n\n" + "\n\n".join(normed)


def build_conversation_context_blocks(
    chat_history: list[dict[str, str]] | None,
    session_state: dict[str, Any] | None,
) -> str:
    """合并 L2 会话态 + L1 verbatim；总长度超预算时优先保留会话态。"""
    session_block = build_session_state_block(session_state)
    history_block = build_history_verbatim_block(chat_history)
    parts: list[str] = []
    if session_block:
        parts.append(session_block)
    if history_block:
        parts.append(history_block)
    if not parts:
        return ""
    combined = "\n\n---\n\n".join(parts)
    total_cap = history_verbatim_budget() + _SESSION_BLOCK_RESERVE
    if len(combined) <= total_cap:
        return combined
    if session_block and len(session_block) >= total_cap - 200:
        return session_block[:total_cap]
    room = total_cap - (len(session_block) + 12 if session_block else 0)
    if history_block and room > 400:
        trimmed_hist = history_block[:room]
        if session_block:
            return session_block + "\n\n---\n\n" + trimmed_hist
        return trimmed_hist
    return combined[:total_cap]


def expand_retrieval_query(question: str, session_state: dict[str, Any] | None) -> str:
    """追问时把会话议题/要点静默并入检索问句（不改用户可见问题）。"""
    q = (question or "").strip()
    if not q or not is_follow_up_query(q):
        return q
    st = normalize_session_state(session_state)
    if not st:
        return q
    bits: list[str] = [q]
    topic = str(st.get("topic") or "").strip()
    if topic and topic not in q:
        bits.append(topic)
    facts = st.get("facts") if isinstance(st.get("facts"), list) else []
    for f in facts[:3]:
        s = str(f).strip()
        if s and s not in q and len(s) >= 6:
            bits.append(s[:80])
            break
    active = [
        t
        for t in (st.get("threads") or [])
        if isinstance(t, dict) and str(t.get("status") or "") == "active"
    ]
    for t in active[:1]:
        about = str(t.get("about") or "").strip()
        if about and about not in q:
            bits.append(about[:60])
    merged = " ".join(bits).strip()
    return merged[:800] if len(merged) > 800 else merged


def normalize_chat_history_validator(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Pydantic validator 共用：条数上限 + 字段清洗。"""
    return pack_chat_history_rows(rows if isinstance(rows, list) else [])
