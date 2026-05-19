"""
资料章节：检测、入库、L1 章摘要、L0 全书摘要、问答路由与覆盖率统计。
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from .db import get_conn, get_cursor
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

_CHAPTER_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+)$", re.MULTILINE)
_CHAPTER_CN_RE = re.compile(
    r"^(?:第\s*[0-9０-９一二三四五六七八九十百千万零两]+\s*[章节回部卷篇]|Chapter\s+\d+)",
    re.IGNORECASE | re.MULTILINE,
)
_CHAPTER_QUERY_RE = re.compile(
    r"第\s*([0-9０-９]+|[一二三四五六七八九十百千万零两]+)\s*[章节回部卷篇]"
)
def relative_chapter_intent(query: str) -> str | None:
    """解析「最后章 / 开篇」等相对指代（不含「第 N 章」数字指代）。"""
    q = (query or "").strip()
    if not q:
        return None
    if re.search(r"最后|末尾|结尾|末章|终章", q):
        return "last"
    if re.search(r"开头(?:一)?[章节回部卷篇]|开篇|首章", q):
        return "first"
    return None

_L1_SUMMARY_SYSTEM = (
    "你是编辑助手。下面是资料某一章/节的正文摘录（可能截断）。"
    "请用中文写 200～400 字摘要：本段主要话题、关键事实与术语；不要编造摘录中没有的内容。"
)
_L0_SUMMARY_SYSTEM = (
    "你是编辑助手。下面是同一篇资料各章摘要。请合并为全书总览（800～1200 字）："
    "主线、结构脉络、关键概念；不要编造章摘要中没有的内容。"
)


@dataclass(frozen=True)
class ChapterSpan:
    chapter_id: str
    title: str
    level: int
    char_start: int
    char_end: int
    parent_id: str | None
    source: str


def ensure_note_chapters_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS note_chapters (
                  input_id UUID NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
                  chapter_id TEXT NOT NULL,
                  title TEXT NOT NULL DEFAULT '',
                  level INT NOT NULL DEFAULT 1,
                  char_start INT NOT NULL DEFAULT 0,
                  char_end INT NOT NULL DEFAULT 0,
                  parent_id TEXT,
                  source TEXT NOT NULL DEFAULT 'unknown',
                  summary_text TEXT,
                  summary_at TIMESTAMPTZ,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (input_id, chapter_id)
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_note_chapters_input ON note_chapters (input_id)"
            )
            conn.commit()


def _fixed_window_chars() -> int:
    try:
        return max(20_000, min(200_000, int(os.getenv("NOTE_CHAPTER_FIXED_CHARS", "50000") or "50000")))
    except (TypeError, ValueError):
        return 50_000


def detect_chapters(body: str, *, segments: list[dict[str, Any]] | None = None) -> list[ChapterSpan]:
    """从正文/结构化分段检测章节边界。"""
    text = (body or "").strip()
    if not text:
        return []

    markers: list[tuple[int, str, int, str]] = []

    for m in _CHAPTER_HEADING_RE.finditer(text):
        level = len(m.group(1))
        title = (m.group(2) or "").strip()[:200]
        if title:
            markers.append((m.start(), title, level, "heading"))

    if not markers:
        for m in _CHAPTER_CN_RE.finditer(text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.start())
            if line_end < 0:
                line_end = len(text)
            title = text[line_start:line_end].strip()[:200]
            if title:
                markers.append((line_start, title, 1, "regex_cn"))

    if not markers and segments:
        offset = 0
        for seg in segments:
            t = str(seg.get("text") or "")
            meta = seg.get("meta") if isinstance(seg.get("meta"), dict) else {}
            hp = meta.get("heading_path") if isinstance(meta.get("heading_path"), list) else []
            if hp:
                title = str(hp[0] if hp else "").strip()[:200]
                if title:
                    markers.append((offset, title, 1, "segment_heading"))
            offset += len(t)

    if not markers:
        win = _fixed_window_chars()
        spans: list[ChapterSpan] = []
        pos = 0
        idx = 0
        while pos < len(text):
            end = min(len(text), pos + win)
            spans.append(
                ChapterSpan(
                    chapter_id=f"c{idx}",
                    title=f"部分 {idx + 1}",
                    level=1,
                    char_start=pos,
                    char_end=end,
                    parent_id=None,
                    source="fixed_window",
                )
            )
            pos = end
            idx += 1
        return spans

    markers.sort(key=lambda x: x[0])
    deduped: list[tuple[int, str, int, str]] = []
    last_pos = -1
    for pos, title, level, src in markers:
        if pos <= last_pos:
            continue
        deduped.append((pos, title, level, src))
        last_pos = pos

    if not deduped:
        return []

    out: list[ChapterSpan] = []
    for i, (pos, title, level, src) in enumerate(deduped):
        end = deduped[i + 1][0] if i + 1 < len(deduped) else len(text)
        if end <= pos:
            continue
        out.append(
            ChapterSpan(
                chapter_id=f"c{i}",
                title=title,
                level=level,
                char_start=pos,
                char_end=end,
                parent_id=None,
                source=src,
            )
        )
    return out


def assign_chapter_ids_to_chunks(
    chunks: list[str],
    chunk_metas: list[dict[str, Any]],
    chapters: list[ChapterSpan],
) -> list[dict[str, Any]]:
    """为切块 meta 写入 chapter_id（按累计字符偏移或 heading_path）。"""
    if not chunks:
        return chunk_metas
    metas = [dict(m) if isinstance(m, dict) else {} for m in chunk_metas]
    while len(metas) < len(chunks):
        metas.append({})

    if not chapters:
        for m in metas:
            m.setdefault("chapter_id", "c0")
        return metas

    offset = 0
    for i, ch in enumerate(chunks):
        piece = ch or ""
        mid = offset + max(1, len(piece)) // 2
        hp = metas[i].get("heading_path")
        if isinstance(hp, list) and hp:
            title = str(hp[0]).strip()
            matched = next((c for c in chapters if c.title == title or title in c.title), None)
            if matched:
                metas[i]["chapter_id"] = matched.chapter_id
                offset += len(piece)
                continue
        cid = chapters[0].chapter_id
        for c in chapters:
            if c.char_start <= mid < c.char_end:
                cid = c.chapter_id
                break
        metas[i]["chapter_id"] = cid
        offset += len(piece)
    return metas


def persist_chapters(note_id: str, chapters: list[ChapterSpan]) -> None:
    ensure_note_chapters_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("DELETE FROM note_chapters WHERE input_id = %s::uuid", (note_id,))
            for c in chapters:
                cur.execute(
                    """
                    INSERT INTO note_chapters (
                      input_id, chapter_id, title, level, char_start, char_end, parent_id, source
                    ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        note_id,
                        c.chapter_id,
                        c.title[:500],
                        c.level,
                        c.char_start,
                        c.char_end,
                        c.parent_id,
                        c.source,
                    ),
                )
            conn.commit()


def list_chapters(note_id: str) -> list[dict[str, Any]]:
    ensure_note_chapters_schema()
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT chapter_id, title, level, char_start, char_end, parent_id, source,
                       summary_text, summary_at
                FROM note_chapters
                WHERE input_id = %s::uuid
                ORDER BY char_start ASC, chapter_id ASC
                """,
                (note_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def chapter_body_slice(body: str, chapter: dict[str, Any], *, max_chars: int | None = None) -> str:
    start = int(chapter.get("char_start") or 0)
    end = int(chapter.get("char_end") or len(body))
    slice_text = (body or "")[max(0, start) : max(start, end)].strip()
    if max_chars and len(slice_text) > max_chars:
        return slice_text[:max_chars] + "\n\n（本章正文较长，以下为章首摘录）"
    return slice_text


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
            timeout_sec=90,
            max_tokens=1200,
        )
        return (out or "").strip()
    except Exception as exc:
        logger.warning("chapter summary llm failed: %s", exc)
        return ""


def build_chapter_and_book_summaries(
    note_id: str,
    body: str,
    chapters: list[ChapterSpan],
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    """L1 章摘要写入 note_chapters；L0 写入 metadata。"""
    ensure_note_chapters_schema()
    l1_parts: list[str] = []
    with_summary = 0
    for c in chapters:
        excerpt = chapter_body_slice(body, c.__dict__, max_chars=10_000)
        summary = _invoke_summary(excerpt, system=_L1_SUMMARY_SYSTEM, api_key=api_key) if excerpt else ""
        if summary:
            with_summary += 1
            l1_parts.append(f"【{c.title}】\n{summary}")
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    UPDATE note_chapters
                    SET summary_text = %s, summary_at = CASE WHEN %s IS NOT NULL AND %s <> '' THEN NOW() ELSE NULL END
                    WHERE input_id = %s::uuid AND chapter_id = %s
                    """,
                    (summary or None, summary, summary, note_id, c.chapter_id),
                )
                conn.commit()

    l0 = ""
    if l1_parts:
        merged = "\n\n".join(l1_parts)[:44_000]
        l0 = _invoke_summary(merged, system=_L0_SUMMARY_SYSTEM, api_key=api_key, cap=44_000)

    return {
        "chaptersTotal": len(chapters),
        "chaptersWithSummary": with_summary,
        "bookSummaryL0": (l0 or "")[:8000],
        "structureSource": chapters[0].source if chapters else "none",
    }


def note_coverage_stats(note_id: str, row: dict[str, Any] | None = None) -> dict[str, Any]:
    """全文字数、向量覆盖率、分片/章处理进度。"""
    from .note_rag_service import count_rag_chunks_for_notes  # 延迟导入，避免与 note_rag_service 循环
    from .note_shards import note_shard_coverage_stats

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

    body_len = len(str((row or {}).get("content_text") or ""))
    rag_total = int(md.get("ragChunksTotal") or 0)
    rag_indexed = int(md.get("ragChunksIndexed") or count_rag_chunks_for_notes([note_id]))
    if not rag_total and rag_indexed:
        rag_total = rag_indexed
    pct = int(md.get("ragIndexCoveragePct") or (100 if body_len < 5000 else 0))
    chapters = list_chapters(note_id)
    ch_total = len(chapters)
    ch_sum = sum(1 for c in chapters if str(c.get("summary_text") or "").strip())
    deep_max = chapter_deep_max_chars()
    deep_ready = sum(
        1
        for c in chapters
        if (int(c.get("char_end") or 0) - int(c.get("char_start") or 0)) <= deep_max
    )
    shard_st = note_shard_coverage_stats(note_id, row)
    return {
        "totalChars": body_len,
        "ragIndexCoveragePct": pct,
        "ragIndexTruncated": bool(md.get("ragIndexTruncated")),
        "ragChunksTotal": rag_total,
        "ragChunksIndexed": rag_indexed,
        "chaptersTotal": ch_total,
        "chaptersWithSummary": ch_sum,
        "chapterSummaryCoveragePct": min(100, round(100.0 * ch_sum / ch_total)) if ch_total else 0,
        "chaptersDeepReady": deep_ready,
        "bookSummaryL0Chars": len(str(md.get("bookSummaryL0") or "")),
        "structureSource": str(md.get("chapterStructureSource") or ""),
        **shard_st,
    }


def chapter_deep_max_chars() -> int:
    try:
        return max(8_000, min(200_000, int(os.getenv("NOTES_ASK_CHAPTER_DEEP_MAX_CHARS", "48000") or "48000")))
    except (TypeError, ValueError):
        return 48_000


def direct_read_max_chars() -> int:
    try:
        return max(5_000, min(120_000, int(os.getenv("NOTES_ASK_DIRECT_READ_MAX_CHARS", "100000") or "100000")))
    except (TypeError, ValueError):
        return 100_000


def chapter_route_min_score() -> float:
    try:
        return max(0.05, min(0.95, float(os.getenv("NOTES_ASK_CHAPTER_ROUTE_MIN_SCORE", "0.22") or "0.22")))
    except (TypeError, ValueError):
        return 0.22


def _chapter_scores_from_query(query: str, chapters: list[dict[str, Any]]) -> list[tuple[float, dict[str, Any]]]:
    q = (query or "").strip().lower()
    if not q or not chapters:
        return []
    scored: list[tuple[float, dict[str, Any]]] = []
    rel = relative_chapter_intent(query)
    if rel == "last":
        scored.append((0.95, chapters[-1]))
    elif rel == "first":
        scored.append((0.95, chapters[0]))
    m = _CHAPTER_QUERY_RE.search(query or "")
    q_num = m.group(1) if m else ""
    for ch in chapters:
        title = str(ch.get("title") or "")
        tl = title.lower()
        score = 0.0
        if q_num and q_num in title:
            score += 0.85
        if tl and tl in q:
            score += 0.7
        for token in re.findall(r"[\u4e00-\u9fff]{2,8}", q):
            if token in title:
                score += 0.25
        summary = str(ch.get("summary_text") or "").lower()
        if summary:
            hits = sum(1 for t in re.findall(r"[\u4e00-\u9fff]{2,}", q) if t in summary)
            score += min(0.5, hits * 0.12)
        if score > 0:
            scored.append((score, ch))
    scored.sort(key=lambda x: -x[0])
    return scored


COMPARE_QUERY_RE = re.compile(
    r"(?:对比|比较|区别|差异|vs\.?|VS|相较|与.+相比|和.+章.+[与和].+章)"
)


def cross_chapter_enabled() -> bool:
    return (os.getenv("NOTES_ASK_CROSS_CHAPTER", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def route_chapters_for_notes(
    *,
    note_ids: list[str],
    query: str,
    bodies_by_note: dict[str, str],
    limit: int = 3,
) -> list[dict[str, Any]]:
    """多资料：每 note 取 Top 章，返回路由结果。"""
    routed: list[dict[str, Any]] = []
    for nid in note_ids:
        chapters = list_chapters(nid)
        if not chapters:
            continue
        for score, ch in _chapter_scores_from_query(query, chapters)[: max(1, limit)]:
            routed.append(
                {
                    "noteId": nid,
                    "chapterId": str(ch.get("chapter_id") or ""),
                    "title": str(ch.get("title") or ""),
                    "score": round(score, 3),
                    "charStart": int(ch.get("char_start") or 0),
                    "charEnd": int(ch.get("char_end") or 0),
                }
            )
    routed.sort(key=lambda x: -float(x.get("score") or 0))
    return routed[:limit]


def route_chapters_for_compare(
    note_id: str,
    query: str,
    *,
    limit: int = 2,
) -> list[dict[str, Any]]:
    """对比类问题：从问句中解析多个章号，或取得分最高的两章。"""
    if not cross_chapter_enabled():
        return []
    chapters = list_chapters(note_id)
    if not chapters:
        return []
    q = (query or "").strip()
    hits: list[dict[str, Any]] = []
    for m in _CHAPTER_QUERY_RE.finditer(q):
        token = m.group(1)
        for ch in chapters:
            title = str(ch.get("title") or "")
            if token and token in title:
                hits.append(
                    {
                        "noteId": note_id,
                        "chapterId": str(ch.get("chapter_id") or ""),
                        "title": title,
                        "score": 0.9,
                    }
                )
                break
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for h in hits:
        cid = h["chapterId"]
        if cid in seen:
            continue
        seen.add(cid)
        deduped.append(h)
    if len(deduped) >= 2:
        return deduped[:limit]
    if COMPARE_QUERY_RE.search(q):
        scored = _chapter_scores_from_query(q, chapters)
        if len(scored) >= 2:
            return [
                {
                    "noteId": note_id,
                    "chapterId": str(ch[1].get("chapter_id") or ""),
                    "title": str(ch[1].get("title") or ""),
                    "score": float(score),
                }
                for score, ch in scored[:limit]
            ]
    return []


def chapter_filter_for_query(
    note_ids: list[str],
    query: str,
    *,
    limit: int = 3,
) -> dict[str, set[str]]:
    """创作/问答共用：根据问句路由章并返回 chapter_filter。"""
    ordered = [str(n).strip() for n in note_ids if str(n).strip()]
    if not ordered:
        return {}
    if len(ordered) == 1 and cross_chapter_enabled() and COMPARE_QUERY_RE.search(query or ""):
        routed = route_chapters_for_compare(ordered[0], query, limit=2)
    else:
        routed = route_chapters_for_notes(note_ids=ordered, query=query, bodies_by_note={}, limit=limit)
    out: dict[str, set[str]] = {}
    for r in routed:
        nid = str(r.get("noteId") or "").strip()
        cid = str(r.get("chapterId") or "").strip()
        if nid and cid:
            out.setdefault(nid, set()).add(cid)
    return out


def coverage_hint_for_qa(
    *,
    note_ids: list[str],
    rows_by_id: dict[str, dict[str, Any]],
    routed: list[dict[str, Any]],
    qa_mode: str,
    routed_shards: list[dict[str, Any]] | None = None,
) -> str:
    parts: list[str] = []
    for nid in note_ids:
        row = rows_by_id.get(nid) or {}
        st = note_coverage_stats(nid, row)
        sh_tot = int(st.get("shardsTotal") or 0)
        sh_sum = int(st.get("shardsWithSummary") or 0)
        vec_pct = int(st.get("ragIndexCoveragePct") or 0)
        if sh_tot > 1 and sh_sum >= sh_tot:
            line = (
                f"资料 {nid[:8]}…：全文约 {st['totalChars']:,} 字，"
                f"片摘要 {sh_sum}/{sh_tot} 已完成（问答可走片路由/精读）。"
                f"向量块为检索抽样约 {vec_pct}% 正文，属设计如此，非摘要未完成。"
            )
        else:
            line = (
                f"资料 {nid[:8]}…：全文约 {st['totalChars']:,} 字，"
                f"向量检索抽样约 {vec_pct}% 正文"
            )
            if sh_tot > 1:
                line += f"，片摘要 {sh_sum}/{sh_tot}"
            elif int(st.get("chaptersTotal") or 0) > 0:
                line += f"，章摘要 {st['chaptersWithSummary']}/{st['chaptersTotal']}"
        line += "。"
        parts.append(line)
    if qa_mode == "shard_deep" and routed_shards:
        titles = "、".join(f"「{r.get('title', '')}」" for r in routed_shards[:3])
        parts.append(f"本轮精读部分：{titles}。")
    elif qa_mode == "chapter_deep" and routed:
        titles = "、".join(f"「{r.get('title', '')}」" for r in routed[:3])
        parts.append(f"本轮精读章节：{titles}。")
    elif qa_mode == "long_context_direct":
        parts.append("本轮为短资料全文精读模式。")
    if any((rows_by_id.get(n) or {}) for n in note_ids):
        if any(note_coverage_stats(n, rows_by_id.get(n)).get("ragIndexTruncated") for n in note_ids if rows_by_id.get(n)):
            parts.append("部分正文未进入向量索引，中间章节请尽量指明章名或使用章精读。")
    return " ".join(parts).strip()
