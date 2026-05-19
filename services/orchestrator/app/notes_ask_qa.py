"""
方案 C + 内部分片：shard 粗路由、chapter 细路由、双轨 QA。
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from .models import get_note_by_id
from .note_chapters import (
    COMPARE_QUERY_RE,
    _CHAPTER_QUERY_RE,
    chapter_body_slice,
    chapter_deep_max_chars,
    chapter_route_min_score,
    coverage_hint_for_qa,
    cross_chapter_enabled,
    direct_read_max_chars,
    list_chapters,
    route_chapters_for_compare,
    route_chapters_for_notes,
)
from .note_rag_service import (
    NOTE_LAYERED_RAG,
    build_layered_notes_context,
    embed_chapters_on_demand,
    embed_shards_on_demand,
    retrieve_chunks_across_notes,
)
from .note_shards import (
    _SHARD_QUERY_PART_RE,
    list_shards,
    notes_ask_top_shards,
    route_shards_for_notes,
    shard_body_slice,
    shard_deep_max_chars,
    shard_filter_for_query,
    shard_route_min_score,
)

logger = logging.getLogger(__name__)


def _ordered_note_ids(note_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw_id in note_ids:
        nid = str(raw_id or "").strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        ordered.append(nid)
    return ordered


def _metadata_title(row: dict[str, Any], note_id: str) -> str:
    md = _metadata_dict(row)
    return str(md.get("title") or note_id).strip() or note_id


def _enrich_sources_with_chunks(
    sources: list[dict[str, Any]], retr_meta: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not retr_meta:
        return sources
    by_note: dict[str, list[dict[str, Any]]] = {}
    for item in retr_meta:
        nid = str(item.get("noteId") or "").strip()
        if not nid:
            continue
        by_note.setdefault(nid, []).append(
            {
                "chunkIndex": str(item.get("chunkIndex") or ""),
                "score": str(item.get("score") or ""),
                "excerpt": str(item.get("excerpt") or "").strip(),
            }
        )
    out: list[dict[str, Any]] = []
    for s in sources:
        merged = dict(s)
        nid = str(s.get("noteId") or "").strip()
        if nid in by_note:
            merged["chunks"] = by_note[nid]
        out.append(merged)
    return out


def notes_ask_qa_mode_env() -> str:
    return (os.getenv("NOTES_ASK_QA_MODE", "auto") or "auto").strip().lower()


def _metadata_dict(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md) if md.strip() else {}
        except Exception:
            md = {}
    return md if isinstance(md, dict) else {}


def _total_chars_for_notes(note_ids: list[str], rows: dict[str, dict[str, Any]]) -> int:
    return sum(len(str((rows.get(n) or {}).get("content_text") or "")) for n in note_ids)


def _active_shards_from_history(chat_history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    if not chat_history:
        return []
    for row in reversed(chat_history):
        if str(row.get("role") or "").strip().lower() != "assistant":
            continue
        raw = row.get("activeShards") or row.get("active_shards")
        if isinstance(raw, list):
            out = []
            for item in raw:
                if isinstance(item, dict) and item.get("noteId") and item.get("shardId"):
                    out.append(
                        {
                            "noteId": str(item["noteId"]),
                            "shardId": str(item["shardId"]),
                            "title": str(item.get("title") or ""),
                        }
                    )
            if out:
                return out
    return []


def _active_chapters_from_history(chat_history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    if not chat_history:
        return []
    for row in reversed(chat_history):
        if str(row.get("role") or "").strip().lower() != "assistant":
            continue
        raw = row.get("activeChapters") or row.get("active_chapters")
        if isinstance(raw, list):
            out = []
            for item in raw:
                if isinstance(item, dict) and item.get("noteId") and item.get("chapterId"):
                    out.append(
                        {
                            "noteId": str(item["noteId"]),
                            "chapterId": str(item["chapterId"]),
                            "title": str(item.get("title") or ""),
                        }
                    )
            if out:
                return out
    return []


def _shard_filter_from_routed(routed: list[dict[str, Any]]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for r in routed:
        nid = str(r.get("noteId") or "").strip()
        sid = str(r.get("shardId") or "").strip()
        if nid and sid:
            out.setdefault(nid, set()).add(sid)
    return out


def _chapter_filter_from_routed(routed: list[dict[str, Any]]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for r in routed:
        nid = str(r.get("noteId") or "").strip()
        cid = str(r.get("chapterId") or "").strip()
        if nid and cid:
            out.setdefault(nid, set()).add(cid)
    return out


def _multi_shard_notes(note_ids: list[str]) -> bool:
    return any(len(list_shards(nid)) > 1 for nid in note_ids)


def resolve_notes_ask_plan(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    chat_history: list[dict[str, str]] | None = None,
    project_owner_user_uuid: str | None = None,
) -> dict[str, Any]:
    """决定 qa_mode、路由片/章、grounding、覆盖率提示。"""
    ordered = _ordered_note_ids(note_ids)
    rows: dict[str, dict[str, Any]] = {}
    bodies: dict[str, str] = {}
    for nid in ordered:
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if row:
            rows[nid] = row
            bodies[nid] = str(row.get("content_text") or "")

    total = _total_chars_for_notes(ordered, rows)
    mode_env = notes_ask_qa_mode_env()
    qa_mode = "rag"
    grounding = "rag_excerpt"

    if mode_env in ("rag", "chapter_deep", "shard_deep", "long_context_direct"):
        qa_mode = mode_env
    elif len(ordered) == 1 and total > 0 and total <= direct_read_max_chars():
        qa_mode = "long_context_direct"
        grounding = "long_context"

    routed_shards = route_shards_for_notes(
        note_ids=ordered, query=question, limit=notes_ask_top_shards()
    )
    follow_shards = _active_shards_from_history(chat_history)
    if follow_shards and not _SHARD_QUERY_PART_RE.search(question or ""):
        routed_shards = [
            {
                "noteId": c["noteId"],
                "shardId": c["shardId"],
                "title": c.get("title") or "",
                "score": 0.5,
            }
            for c in follow_shards
        ]

    routed_chapters = route_chapters_for_notes(
        note_ids=ordered, query=question, bodies_by_note=bodies, limit=3
    )
    cross_chapter = False
    if (
        cross_chapter_enabled()
        and len(ordered) == 1
        and COMPARE_QUERY_RE.search(question or "")
    ):
        cmp_routed = route_chapters_for_compare(ordered[0], question, limit=2)
        if len(cmp_routed) >= 2:
            routed_chapters = cmp_routed
            cross_chapter = True
    follow_chapters = _active_chapters_from_history(chat_history)
    if follow_chapters and not re.search(_CHAPTER_QUERY_RE, question or ""):
        routed_chapters = [
            {
                "noteId": c["noteId"],
                "chapterId": c["chapterId"],
                "title": c.get("title") or "",
                "score": 0.5,
            }
            for c in follow_chapters
        ]

    best_shard = float(routed_shards[0].get("score") or 0) if routed_shards else 0.0
    best_chapter = float(routed_chapters[0].get("score") or 0) if routed_chapters else 0.0
    multi_shard = _multi_shard_notes(ordered)

    if mode_env == "auto":
        if multi_shard and routed_shards and best_shard >= shard_route_min_score():
            qa_mode = "shard_deep"
            grounding = "shard_deep"
        elif routed_chapters and best_chapter >= chapter_route_min_score():
            qa_mode = "chapter_deep"
            grounding = "chapter_deep"
        elif len(ordered) == 1 and total <= direct_read_max_chars():
            qa_mode = "long_context_direct"
            grounding = "long_context"

    hint = coverage_hint_for_qa(
        note_ids=ordered,
        rows_by_id=rows,
        routed=routed_chapters,
        routed_shards=routed_shards,
        qa_mode=qa_mode,
    )
    return {
        "qaMode": qa_mode,
        "grounding": grounding,
        "routedShards": routed_shards,
        "routedChapters": routed_chapters,
        "coverageHint": hint,
        "totalChars": total,
        "rowsByNoteId": rows,
        "crossChapter": cross_chapter,
        "multiShard": multi_shard,
    }


def _build_shard_deep_block(
    *,
    routed: list[dict[str, Any]],
    rows: dict[str, dict[str, Any]],
    question: str,
    retrieval_budget: int,
    user_ref: str | None = None,
    api_key: str | None = None,
    chapter_routed: list[dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    parts: list[str] = []
    meta_excerpts: list[dict[str, Any]] = []
    sh_filter = _shard_filter_from_routed(routed)
    ch_filter = _chapter_filter_from_routed(chapter_routed or [])

    for nid, sids in sh_filter.items():
        try:
            embed_shards_on_demand(nid, list(sids), user_ref=user_ref, api_key=api_key)
        except Exception as exc:
            logger.warning("shard_deep on_demand embed: %s", exc)

    for r in routed:
        nid = str(r.get("noteId") or "").strip()
        row = rows.get(nid) or {}
        body = str(row.get("content_text") or "")
        shards = list_shards(nid)
        sh = next((s for s in shards if str(s.get("shard_id")) == str(r.get("shardId"))), None)
        if not sh:
            continue
        title = str(sh.get("title") or r.get("title") or "")
        sh_len = int(sh.get("char_end") or 0) - int(sh.get("char_start") or 0)
        deep_max = shard_deep_max_chars()
        summary = str(sh.get("summary_text") or "").strip()
        if summary:
            parts.append(f"### 部分摘要：{title}\n\n{summary}")

        if ch_filter.get(nid) and chapter_routed:
            from .note_chapters import chapter_body_slice as ch_slice

            chapters = list_chapters(nid)
            for cr in chapter_routed:
                if str(cr.get("noteId")) != nid:
                    continue
                ch = next(
                    (c for c in chapters if str(c.get("chapter_id")) == str(cr.get("chapterId"))),
                    None,
                )
                if ch:
                    ct = str(ch.get("title") or "")
                    parts.append(f"### 章摘录 · {ct}\n\n{ch_slice(body, ch, max_chars=12_000)}")
            retr, retr_meta, _ = retrieve_chunks_across_notes(
                note_ids=[nid],
                query=question,
                max_chars=max(4000, retrieval_budget // max(1, len(routed))),
                top_k=24,
                notes_ask_fast_path=True,
                shard_filter=sh_filter,
                chapter_filter=ch_filter,
                user_ref=user_ref,
                api_key=api_key,
            )
            if retr:
                parts.append(f"### 片内检索摘录 · {title}\n\n{retr}")
                meta_excerpts.extend(retr_meta if isinstance(retr_meta, list) else [])
            continue

        if sh_len <= deep_max and body:
            full = shard_body_slice(body, sh)
            parts.append(f"### 部分正文（精读）· {title}\n\n{full}")
            continue

        retr, retr_meta, _ = retrieve_chunks_across_notes(
            note_ids=[nid],
            query=question,
            max_chars=max(4000, retrieval_budget // max(1, len(routed))),
            top_k=24,
            notes_ask_fast_path=True,
            shard_filter=sh_filter,
            user_ref=user_ref,
            api_key=api_key,
        )
        if retr:
            parts.append(f"### 片内检索摘录 · {title}\n\n{retr}")
            meta_excerpts.extend(retr_meta if isinstance(retr_meta, list) else [])

    if not parts:
        return "", meta_excerpts
    header = "## 分片精读上下文（路由部分；事实以摘录为准）"
    if len(routed) >= 2:
        header = "## 跨分片对比上下文（分别摘录后综合；勿混淆不同部分的事实）"
    return header + "\n\n" + "\n\n---\n\n".join(parts), meta_excerpts


def _build_chapter_deep_block(
    *,
    routed: list[dict[str, Any]],
    rows: dict[str, dict[str, Any]],
    question: str,
    retrieval_budget: int,
    user_ref: str | None = None,
    api_key: str | None = None,
    shard_filter: dict[str, set[str]] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    parts: list[str] = []
    meta_excerpts: list[dict[str, Any]] = []
    ch_filter = _chapter_filter_from_routed(routed)
    for nid, cids in ch_filter.items():
        try:
            embed_chapters_on_demand(nid, list(cids), user_ref=user_ref, api_key=api_key)
        except Exception as exc:
            logger.warning("chapter_deep on_demand embed: %s", exc)

    for r in routed:
        nid = str(r.get("noteId") or "").strip()
        row = rows.get(nid) or {}
        body = str(row.get("content_text") or "")
        chapters = list_chapters(nid)
        ch = next((c for c in chapters if str(c.get("chapter_id")) == str(r.get("chapterId"))), None)
        if not ch:
            continue
        title = str(ch.get("title") or r.get("title") or "")
        ch_len = int(ch.get("char_end") or 0) - int(ch.get("char_start") or 0)
        deep_max = chapter_deep_max_chars()
        summary = str(ch.get("summary_text") or "").strip()
        if summary:
            parts.append(f"### 章摘要：{title}\n\n{summary}")

        if ch_len <= deep_max and body:
            full = chapter_body_slice(body, ch)
            parts.append(f"### 章正文（精读）· {title}\n\n{full}")
            continue

        retr, retr_meta, _ = retrieve_chunks_across_notes(
            note_ids=[nid],
            query=question,
            max_chars=max(4000, retrieval_budget // max(1, len(routed))),
            top_k=24,
            notes_ask_fast_path=True,
            chapter_filter=ch_filter,
            shard_filter=shard_filter,
            user_ref=user_ref,
            api_key=api_key,
        )
        if retr:
            parts.append(f"### 章内检索摘录 · {title}\n\n{retr}")
            meta_excerpts.extend(retr_meta if isinstance(retr_meta, list) else [])

    if not parts:
        return "", meta_excerpts
    header = "## 章精读上下文（路由章节；事实以摘录为准）"
    if len(routed) >= 2:
        header = "## 跨章对比上下文（分别摘录后综合；勿混淆不同章的事实）"
    return header + "\n\n" + "\n\n---\n\n".join(parts), meta_excerpts


def build_notes_qa_context_with_plan(
    *,
    notebook: str,
    note_ids: list[str],
    question: str,
    user_ref: str | None,
    project_owner_user_uuid: str | None = None,
    top_k: int | None = None,
    chat_history: list[dict[str, str]] | None = None,
    plan: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """带分片/章路由的上下文构建；失败时降级 RAG / legacy。"""
    q = (question or "").strip()
    ordered = _ordered_note_ids(note_ids)
    if plan is None:
        plan = resolve_notes_ask_plan(
            notebook=notebook,
            note_ids=ordered,
            question=q,
            user_ref=user_ref,
            chat_history=chat_history,
            project_owner_user_uuid=project_owner_user_uuid,
        )

    qa_mode = str(plan.get("qaMode") or "rag")
    rows: dict[str, dict[str, Any]] = plan.get("rowsByNoteId") or {}
    meta: dict[str, Any] = {
        "qaMode": qa_mode,
        "grounding": plan.get("grounding"),
        "routedShards": plan.get("routedShards") or [],
        "routedChapters": plan.get("routedChapters") or [],
        "coverageHint": plan.get("coverageHint") or "",
    }

    sources: list[dict[str, Any]] = []
    for i, nid in enumerate(ordered, start=1):
        row = rows.get(nid) or get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if row:
            sources.append({"index": str(i), "noteId": nid, "title": _metadata_title(row, nid)})

    if qa_mode == "long_context_direct" and len(ordered) == 1:
        nid = ordered[0]
        row = rows.get(nid) or {}
        body = str(row.get("content_text") or "")[:direct_read_max_chars()]
        md = _metadata_dict(row)
        l0 = str(md.get("bookSummaryL0") or row.get("note_summary") or "").strip()
        blocks = []
        if l0:
            blocks.append(f"## 全书概览（机器摘要）\n\n{l0}")
        blocks.append(f"## 资料全文（短资料精读模式）\n\n{body}")
        ctx = "\n\n---\n\n".join(blocks)
        meta["layered"] = True
        return ctx, sources, meta

    if qa_mode == "shard_deep":
        routed = plan.get("routedShards") or []
        ch_routed = plan.get("routedChapters") or []
        sh_block, retr_meta = _build_shard_deep_block(
            routed=routed,
            rows=rows,
            question=q,
            retrieval_budget=28_000,
            user_ref=user_ref,
            api_key=None,
            chapter_routed=ch_routed if re.search(_CHAPTER_QUERY_RE, q) else None,
        )
        if not sh_block:
            logger.info("shard_deep empty, degrade to layered RAG")
            qa_mode = "rag"
            meta["qaMode"] = "rag"
            meta["grounding"] = "rag_excerpt"
            meta["degradedFrom"] = "shard_deep"
        else:
            sh_filter = _shard_filter_from_routed(routed)
            ch_filter = _chapter_filter_from_routed(ch_routed) if ch_routed else None
            if NOTE_LAYERED_RAG and q:
                layered, sources, lmeta = build_layered_notes_context(
                    notebook=notebook,
                    note_ids=ordered,
                    query=q,
                    user_ref=user_ref,
                    summary_budget=8_000,
                    retrieval_budget=12_000,
                    top_k=min(20, top_k or 24),
                    project_owner_user_uuid=project_owner_user_uuid,
                    shard_filter=sh_filter,
                    chapter_filter=ch_filter,
                )
                if layered:
                    ctx = sh_block + "\n\n---\n\n" + layered
                    if isinstance(retr_meta, list) and retr_meta:
                        sources = _enrich_sources_with_chunks(sources, retr_meta)
                    meta.update(lmeta)
                    meta["qaMode"] = qa_mode
                    return ctx, sources, meta
            meta["layered"] = True
            if isinstance(retr_meta, list) and retr_meta:
                sources = _enrich_sources_with_chunks(sources, retr_meta)
            return sh_block, sources, meta

    if qa_mode == "chapter_deep":
        routed = plan.get("routedChapters") or []
        sh_filter = shard_filter_for_query(ordered, q) if _multi_shard_notes(ordered) else None
        ch_block, retr_meta = _build_chapter_deep_block(
            routed=routed,
            rows=rows,
            question=q,
            retrieval_budget=28_000,
            user_ref=user_ref,
            api_key=None,
            shard_filter=sh_filter,
        )
        if not ch_block:
            logger.info("chapter_deep empty, degrade to layered RAG")
            qa_mode = "rag"
            meta["qaMode"] = "rag"
            meta["grounding"] = "rag_excerpt"
            meta["degradedFrom"] = "chapter_deep"
        else:
            ch_filter = _chapter_filter_from_routed(routed)
            if NOTE_LAYERED_RAG and q:
                layered, sources, lmeta = build_layered_notes_context(
                    notebook=notebook,
                    note_ids=ordered,
                    query=q,
                    user_ref=user_ref,
                    summary_budget=8_000,
                    retrieval_budget=12_000,
                    top_k=min(20, top_k or 24),
                    project_owner_user_uuid=project_owner_user_uuid,
                    chapter_filter=ch_filter,
                    shard_filter=sh_filter,
                )
                if layered:
                    ctx = ch_block + "\n\n---\n\n" + layered
                    if isinstance(retr_meta, list) and retr_meta:
                        sources = _enrich_sources_with_chunks(sources, retr_meta)
                    meta.update(lmeta)
                    meta["qaMode"] = qa_mode
                    return ctx, sources, meta
            meta["layered"] = True
            if isinstance(retr_meta, list) and retr_meta:
                sources = _enrich_sources_with_chunks(sources, retr_meta)
            return ch_block, sources, meta

    if qa_mode == "rag" and NOTE_LAYERED_RAG and q:
        sh_filter = shard_filter_for_query(ordered, q) if _multi_shard_notes(ordered) else None
        layered, sources, lmeta = build_layered_notes_context(
            notebook=notebook,
            note_ids=ordered,
            query=q,
            user_ref=user_ref,
            summary_budget=14_000,
            retrieval_budget=36_000,
            top_k=top_k or 36,
            project_owner_user_uuid=project_owner_user_uuid,
            shard_filter=sh_filter,
        )
        if layered:
            meta.update(lmeta)
            return layered, sources, meta

    from .notes_ask import legacy_build_notes_qa_context

    ctx, sources = legacy_build_notes_qa_context(
        notebook=notebook,
        note_ids=ordered,
        user_ref=user_ref,
        question=q,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    meta["layered"] = False
    return ctx, sources, meta
