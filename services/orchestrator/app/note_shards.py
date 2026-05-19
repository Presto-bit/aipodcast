"""
资料内部分片（Shard）：用户层 1 条 note，处理层 N 片，问答先路由 1～k 片。
"""
from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

from .db import get_conn, get_cursor
from .note_chapters import ChapterSpan, detect_chapters
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_SHARD_PARTIAL_SYSTEM = (
    "你是编辑助手。下面是一篇资料连续片段。请用中文写 200～400 字分段摘要："
    "本段主要话题与要点；不要编造片段中没有的内容。"
)
_SHARD_MERGE_SYSTEM = (
    "你是编辑助手。下面是资料某一「部分」的多个分段摘要。请合并为一份 200～500 字摘要："
    "本部分主线与关键事实；不要编造中没有的内容。"
)
_L0_FROM_SHARDS_SYSTEM = (
    "你是编辑助手。下面是同一篇资料各部分的摘要。请合并为全书总览（800～1200 字）："
    "主线、结构脉络、关键概念；不要编造部分摘要中没有的内容。"
)

_SHARD_QUERY_PART_RE = re.compile(
    r"(?:第\s*([0-9０-９]+)\s*部分|部分\s*([0-9０-９]+)|Part\s*(\d+))",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ShardSpan:
    shard_id: str
    title: str
    char_start: int
    char_end: int
    source: str
    ordinal: int


def ensure_note_shards_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS note_shards (
                  input_id UUID NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
                  shard_id TEXT NOT NULL,
                  title TEXT NOT NULL DEFAULT '',
                  char_start INT NOT NULL DEFAULT 0,
                  char_end INT NOT NULL DEFAULT 0,
                  source TEXT NOT NULL DEFAULT 'auto',
                  ordinal INT NOT NULL DEFAULT 0,
                  summary_text TEXT,
                  summary_at TIMESTAMPTZ,
                  index_status TEXT NOT NULL DEFAULT 'pending',
                  index_error TEXT,
                  chunk_count INT NOT NULL DEFAULT 0,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (input_id, shard_id)
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_note_shards_input ON note_shards (input_id)"
            )
            conn.commit()


def _shard_min_chars() -> int:
    try:
        return max(20_000, min(500_000, int(os.getenv("NOTE_SHARD_MIN_CHARS", "120000") or "120000")))
    except (TypeError, ValueError):
        return 120_000


def _shard_target_chars() -> int:
    try:
        return max(30_000, min(200_000, int(os.getenv("NOTE_SHARD_TARGET_CHARS", "100000") or "100000")))
    except (TypeError, ValueError):
        return 100_000


def _shard_max_count() -> int:
    try:
        return max(1, min(128, int(os.getenv("NOTE_SHARD_MAX_COUNT", "64") or "64")))
    except (TypeError, ValueError):
        return 64


def _shard_max_chapters() -> int:
    try:
        return max(1, min(64, int(os.getenv("NOTE_SHARD_MAX_CHAPTERS", "24") or "24")))
    except (TypeError, ValueError):
        return 24


def _align_break(text: str, pos: int) -> int:
    """在 pos 附近向回寻找换行，避免句中断。"""
    if pos <= 0 or pos >= len(text):
        return pos
    window = text[max(0, pos - 400) : pos]
    nl = window.rfind("\n\n")
    if nl >= 0:
        return max(0, pos - 400) + nl + 2
    nl = window.rfind("\n")
    if nl >= 0:
        return max(0, pos - 400) + nl + 1
    return pos


def _fixed_window_shards(body: str, target: int, max_shards: int) -> list[ShardSpan]:
    text = body
    n = len(text)
    if n <= target:
        return [ShardSpan("s0", "全文", 0, n, "single", 0)]
    spans: list[ShardSpan] = []
    pos = 0
    idx = 0
    while pos < n and idx < max_shards:
        end = min(n, pos + target)
        if end < n:
            end = _align_break(text, end)
            if end <= pos:
                end = min(n, pos + target)
        title = f"第 {idx + 1} 部分" if idx > 0 or end < n else "第 1 部分"
        spans.append(ShardSpan(f"s{idx}", title, pos, end, "fixed_window", idx))
        pos = end
        idx += 1
    if pos < n and spans:
        last = spans[-1]
        spans[-1] = ShardSpan(
            last.shard_id,
            last.title,
            last.char_start,
            n,
            last.source,
            last.ordinal,
        )
    return spans


def _chapters_to_shards(chapters: list[ChapterSpan], target: int) -> list[ShardSpan]:
    if not chapters:
        return []
    spans: list[ShardSpan] = []
    buf_start = chapters[0].char_start
    buf_titles: list[str] = []
    buf_end = chapters[0].char_end
    idx = 0

    def flush(end: int, titles: list[str]) -> None:
        nonlocal idx
        title = titles[0] if len(titles) == 1 else f"{titles[0]} 等（{len(titles)} 章）"
        spans.append(
            ShardSpan(f"s{idx}", title[:200], buf_start, end, "merge_chapters", idx)
        )
        idx += 1

    for ch in chapters:
        seg_len = ch.char_end - buf_start
        if buf_titles and seg_len > target * 1.15:
            flush(buf_end, buf_titles)
            buf_start = ch.char_start
            buf_titles = [ch.title]
            buf_end = ch.char_end
        else:
            if not buf_titles:
                buf_start = ch.char_start
            buf_titles.append(ch.title)
            buf_end = ch.char_end
    if buf_titles:
        flush(buf_end, buf_titles)
    return spans


def detect_shards(body: str, *, segments: list[dict[str, Any]] | None = None) -> list[ShardSpan]:
    text = (body or "").strip()
    if not text:
        return []
    n = len(text)
    min_c = _shard_min_chars()
    target = _shard_target_chars()
    max_n = _shard_max_count()
    if n <= min_c:
        return [ShardSpan("s0", "全文", 0, n, "single", 0)]

    chapters = detect_chapters(text, segments=segments)
    many_fixed = (
        len(chapters) > _shard_max_chapters()
        or (chapters and chapters[0].source == "fixed_window" and len(chapters) > 20)
    )
    if chapters and not many_fixed:
        shards = _chapters_to_shards(chapters, target)
        if len(shards) <= max_n:
            return shards

    return _fixed_window_shards(text, target, max_n)


def persist_shards(note_id: str, shards: list[ShardSpan]) -> None:
    ensure_note_shards_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("DELETE FROM note_shards WHERE input_id = %s::uuid", (note_id,))
            for s in shards:
                cur.execute(
                    """
                    INSERT INTO note_shards (
                      input_id, shard_id, title, char_start, char_end, source, ordinal,
                      index_status, chunk_count
                    ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, 'pending', 0)
                    """,
                    (note_id, s.shard_id, s.title, s.char_start, s.char_end, s.source, s.ordinal),
                )
            conn.commit()


def list_shards(note_id: str) -> list[dict[str, Any]]:
    ensure_note_shards_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT shard_id, title, char_start, char_end, source, ordinal,
                       summary_text, summary_at, index_status, index_error, chunk_count
                FROM note_shards
                WHERE input_id = %s::uuid
                ORDER BY ordinal ASC, char_start ASC
                """,
                (note_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def shard_body_slice(body: str, shard: dict[str, Any], *, max_chars: int | None = None) -> str:
    start = int(shard.get("char_start") or 0)
    end = int(shard.get("char_end") or len(body))
    slice_text = (body or "")[max(0, start) : max(start, end)].strip()
    if max_chars and len(slice_text) > max_chars:
        return slice_text[:max_chars] + "\n\n（本部分正文较长，以下为篇首摘录）"
    return slice_text


def assign_shard_ids_to_chunks(
    chunks: list[str],
    chunk_metas: list[dict[str, Any]],
    shards: list[ShardSpan],
) -> list[dict[str, Any]]:
    if not chunks:
        return chunk_metas
    metas = [dict(m) if isinstance(m, dict) else {} for m in chunk_metas]
    while len(metas) < len(chunks):
        metas.append({})
    if not shards:
        for m in metas:
            m.setdefault("shard_id", "s0")
        return metas
    offset = 0
    for i, ch in enumerate(chunks):
        piece = ch or ""
        mid = offset + max(1, len(piece)) // 2
        sid = shards[0].shard_id
        for s in shards:
            if s.char_start <= mid < s.char_end:
                sid = s.shard_id
                break
        metas[i]["shard_id"] = sid
        offset += len(piece)
    return metas


def _invoke_summary(text: str, *, system: str, api_key: str | None, cap: int = 12_000) -> str:
    if not (text or "").strip():
        return ""
    try:
        out, _ = invoke_llm_chat_messages_with_minimax_fallback(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": (text or "")[:cap]},
            ],
            temperature=0.35,
            api_key=api_key,
            timeout_sec=120,
            max_tokens=1200,
        )
        return (out or "").strip()
    except Exception as exc:
        logger.warning("shard summary llm failed: %s", exc)
        return ""


def _summarize_shard_slice(slice_text: str, api_key: str | None) -> str:
    from .note_rag_service import summarize_body_map_reduce

    if not slice_text.strip():
        return ""
    if len(slice_text) <= 12_000:
        return _invoke_summary(slice_text, system=_SHARD_MERGE_SYSTEM, api_key=api_key, cap=12_000)
    summary, _ = summarize_body_map_reduce(slice_text, api_key, partial_system=_SHARD_PARTIAL_SYSTEM)
    if summary:
        return _invoke_summary(summary, system=_SHARD_MERGE_SYSTEM, api_key=api_key, cap=12_000)
    return ""


def update_shard_index_status(
    note_id: str,
    shard_id: str,
    *,
    status: str,
    error: str | None = None,
    chunk_count: int | None = None,
    summary: str | None = None,
) -> None:
    ensure_note_shards_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if summary is not None:
                cur.execute(
                    """
                    UPDATE note_shards
                    SET index_status = %s, index_error = %s, chunk_count = COALESCE(%s, chunk_count),
                        summary_text = %s,
                        summary_at = CASE WHEN %s IS NOT NULL AND %s <> '' THEN NOW() ELSE summary_at END
                    WHERE input_id = %s::uuid AND shard_id = %s
                    """,
                    (
                        status,
                        error,
                        chunk_count,
                        summary or None,
                        summary,
                        summary,
                        note_id,
                        shard_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE note_shards
                    SET index_status = %s, index_error = %s, chunk_count = COALESCE(%s, chunk_count)
                    WHERE input_id = %s::uuid AND shard_id = %s
                    """,
                    (status, error, chunk_count, note_id, shard_id),
                )
            conn.commit()


def _shard_index_parallelism() -> int:
    try:
        return max(1, min(8, int(os.getenv("NOTE_RAG_SHARD_INDEX_PARALLEL", "3") or "3")))
    except (TypeError, ValueError):
        return 3


def _summarize_one_shard(
    note_id: str,
    body: str,
    shard: ShardSpan,
    *,
    api_key: str | None,
) -> tuple[str, bool]:
    update_shard_index_status(note_id, shard.shard_id, status="indexing", error=None)
    excerpt = shard_body_slice(body, shard.__dict__, max_chars=48_000)
    summary = _summarize_shard_slice(excerpt, api_key) if excerpt else ""
    ok = bool(summary)
    update_shard_index_status(
        note_id,
        shard.shard_id,
        status="ready" if ok else "failed",
        error=None if ok else "summary_empty",
        summary=summary,
    )
    return shard.shard_id, ok


def shard_index_progress(note_id: str) -> dict[str, Any]:
    """供 API：片级索引进度。"""
    shards = list_shards(note_id)
    total = len(shards)
    ready = sum(1 for s in shards if str(s.get("index_status") or "") == "ready")
    with_sum = sum(1 for s in shards if str(s.get("summary_text") or "").strip())
    indexing = sum(1 for s in shards if str(s.get("index_status") or "") == "indexing")
    failed = sum(1 for s in shards if str(s.get("index_status") or "") == "failed")
    return {
        "shardsTotal": total,
        "shardsReady": ready,
        "shardsWithSummary": with_sum,
        "shardsIndexing": indexing,
        "shardsFailed": failed,
        "percent": min(100, round(100.0 * ready / total)) if total else 0,
    }


def build_shard_and_book_summaries(
    note_id: str,
    body: str,
    shards: list[ShardSpan],
    *,
    api_key: str | None = None,
    only_shard_ids: list[str] | None = None,
) -> dict[str, Any]:
    """每片 Map-Reduce 摘要 + 全书 L0；并行片摘要。"""
    ensure_note_shards_schema()
    want = {str(x) for x in only_shard_ids} if only_shard_ids else None
    todo = [s for s in shards if want is None or s.shard_id in want]
    workers = min(_shard_index_parallelism(), max(1, len(todo)))
    if len(todo) <= 1 or workers <= 1:
        for s in todo:
            _summarize_one_shard(note_id, body, s, api_key=api_key)
    else:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="shard-sum") as pool:
            futs = [
                pool.submit(_summarize_one_shard, note_id, body, s, api_key=api_key)
                for s in todo
            ]
            for fut in as_completed(futs):
                try:
                    fut.result()
                except Exception as exc:
                    logger.warning("parallel shard summary failed: %s", exc)

    all_shards = list_shards(note_id)
    with_summary = sum(1 for x in all_shards if str(x.get("summary_text") or "").strip())
    l1_parts = [
        f"【{x.get('title')}】\n{x.get('summary_text')}"
        for x in all_shards
        if str(x.get("summary_text") or "").strip()
    ]

    l0 = ""
    if l1_parts:
        merged = "\n\n".join(l1_parts)[:44_000]
        l0 = _invoke_summary(merged, system=_L0_FROM_SHARDS_SYSTEM, api_key=api_key, cap=44_000)

    return {
        "shardsTotal": len(shards),
        "shardsWithSummary": with_summary,
        "shardStructureSource": shards[0].source if shards else "none",
        "bookSummaryL0": (l0 or "")[:8000],
    }


def _shard_scores_from_query(query: str, shards: list[dict[str, Any]]) -> list[tuple[float, dict[str, Any]]]:
    q = (query or "").strip().lower()
    if not q or not shards:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    m = _SHARD_QUERY_PART_RE.search(query or "")
    part_num = (m.group(1) or m.group(2) or m.group(3) or "") if m else ""
    for sh in shards:
        title = str(sh.get("title") or "")
        tl = title.lower()
        score = 0.0
        if part_num and part_num in title:
            score += 0.9
        if tl and tl in q:
            score += 0.65
        for token in re.findall(r"[\u4e00-\u9fff]{2,8}", q):
            if token in title:
                score += 0.2
        summary = str(sh.get("summary_text") or "").lower()
        if summary:
            hits = sum(1 for t in re.findall(r"[\u4e00-\u9fff]{2,}", q) if t in summary)
            score += min(0.45, hits * 0.1)
        if score > 0:
            scored.append((score, sh))
    scored.sort(key=lambda x: -x[0])
    return scored


def route_shards_for_notes(
    *,
    note_ids: list[str],
    query: str,
    limit: int = 2,
) -> list[dict[str, Any]]:
    routed: list[dict[str, Any]] = []
    for nid in note_ids:
        shards = list_shards(nid)
        if not shards:
            continue
        if len(shards) == 1:
            sh = shards[0]
            routed.append(
                {
                    "noteId": nid,
                    "shardId": str(sh.get("shard_id") or "s0"),
                    "title": str(sh.get("title") or ""),
                    "score": 0.55,
                    "charStart": int(sh.get("char_start") or 0),
                    "charEnd": int(sh.get("char_end") or 0),
                }
            )
            continue
        for score, sh in _shard_scores_from_query(query, shards)[: max(1, limit)]:
            routed.append(
                {
                    "noteId": nid,
                    "shardId": str(sh.get("shard_id") or ""),
                    "title": str(sh.get("title") or ""),
                    "score": round(score, 3),
                    "charStart": int(sh.get("char_start") or 0),
                    "charEnd": int(sh.get("char_end") or 0),
                }
            )
    routed.sort(key=lambda x: -float(x.get("score") or 0))
    return routed[:limit]


def shard_route_min_score() -> float:
    try:
        return max(0.05, min(0.95, float(os.getenv("NOTES_ASK_SHARD_ROUTE_MIN_SCORE", "0.20") or "0.20")))
    except (TypeError, ValueError):
        return 0.20


def shard_deep_max_chars() -> int:
    try:
        return max(8_000, min(200_000, int(os.getenv("NOTES_ASK_SHARD_DEEP_MAX_CHARS", "48000") or "48000")))
    except (TypeError, ValueError):
        return 48_000


def shard_direct_read_max_chars() -> int:
    try:
        return max(10_000, min(200_000, int(os.getenv("NOTES_ASK_SHARD_DIRECT_READ_MAX_CHARS", "120000") or "120000")))
    except (TypeError, ValueError):
        return 120_000


def notes_ask_top_shards() -> int:
    try:
        return max(1, min(5, int(os.getenv("NOTES_ASK_TOP_SHARDS", "2") or "2")))
    except (TypeError, ValueError):
        return 2


def shard_filter_for_query(
    note_ids: list[str],
    query: str,
    *,
    limit: int | None = None,
) -> dict[str, set[str]]:
    lim = limit if limit is not None else notes_ask_top_shards()
    routed = route_shards_for_notes(note_ids=note_ids, query=query, limit=lim)
    out: dict[str, set[str]] = {}
    for r in routed:
        nid = str(r.get("noteId") or "").strip()
        sid = str(r.get("shardId") or "").strip()
        if nid and sid:
            out.setdefault(nid, set()).add(sid)
    return out


def note_shard_coverage_stats(note_id: str, row: dict[str, Any] | None = None) -> dict[str, Any]:
    shards = list_shards(note_id)
    total = len(shards)
    ready = sum(1 for s in shards if str(s.get("index_status") or "") == "ready")
    with_sum = sum(1 for s in shards if str(s.get("summary_text") or "").strip())
    md: dict[str, Any] = {}
    if row:
        raw = row.get("metadata") or {}
        if isinstance(raw, str):
            try:
                md = json.loads(raw) if raw.strip() else {}
            except Exception:
                md = {}
        elif isinstance(raw, dict):
            md = raw
    return {
        "shardsTotal": total,
        "shardsReady": ready,
        "shardsWithSummary": with_sum,
        "shardSummaryCoveragePct": min(100, round(100.0 * with_sum / total)) if total else 0,
        "shardStructureSource": str(md.get("shardStructureSource") or (shards[0].get("source") if shards else "")),
    }


def sync_shard_chunk_counts(note_id: str) -> None:
    """索引完成后按 chunk_meta.shard_id 回写各片 chunk_count。"""
    ensure_note_shards_schema()
    counts: dict[str, int] = {}
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT COALESCE(chunk_meta->>'shard_id', 's0') AS sid, COUNT(*)::int AS c
                FROM note_rag_chunks
                WHERE input_id = %s::uuid
                GROUP BY 1
                """,
                (note_id,),
            )
            for r in cur.fetchall():
                counts[str(r.get("sid") or "s0")] = int(r.get("c") or 0)
            for sid, c in counts.items():
                cur.execute(
                    """
                    UPDATE note_shards SET chunk_count = %s, index_status = 'ready'
                    WHERE input_id = %s::uuid AND shard_id = %s
                    """,
                    (c, note_id, sid),
                )
            cur.execute(
                """
                UPDATE note_shards SET index_status = 'ready', chunk_count = 0
                WHERE input_id = %s::uuid AND shard_id NOT IN (
                  SELECT COALESCE(chunk_meta->>'shard_id', 's0') FROM note_rag_chunks WHERE input_id = %s::uuid
                )
                """,
                (note_id, note_id),
            )
            conn.commit()
