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
    relative_chapter_intent,
    chapter_body_slice,
    chapter_deep_max_chars,
    chapter_route_min_score,
    coverage_hint_for_qa,
    cross_chapter_enabled,
    note_coverage_stats,
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
    shard_direct_read_max_chars,
    shard_filter_for_query,
    shard_route_min_score,
)
from .note_long_doc import (
    is_long_doc,
    is_very_long_doc,
    proactive_on_demand_enabled,
)
from .note_rag_profile import query_suggests_table
from .notes_ask_style import (
    classify_answer_type,
    divide_budgets_per_note,
    per_note_retrieval_top_k,
    resolve_qa_retrieval_budgets,
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
        ex = str(item.get("excerpt") or "").strip()
        chunk_row: dict[str, Any] = {
            "chunkIndex": str(item.get("chunkIndex") or ""),
            "score": str(item.get("score") or ""),
            "excerpt": ex,
        }
        try:
            cs = int(item.get("charStart"))
            ce = int(item.get("charEnd"))
            if ce > cs >= 0:
                chunk_row["charStart"] = cs
                chunk_row["charEnd"] = ce
        except (TypeError, ValueError):
            pass
        by_note.setdefault(nid, []).append(chunk_row)
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


from .note_corpus import detect_corpus_mode as _detect_corpus_mode


def _build_multi_note_digest_prefix(
    notebook: str,
    ordered_note_ids: list[str],
    *,
    user_ref: str | None,
) -> str:
    if len(ordered_note_ids) < 2 or not (notebook or "").strip():
        return ""
    try:
        from .note_notebook_digest import get_notebook_digest

        dj = get_notebook_digest(notebook.strip(), user_ref=user_ref)
    except Exception:
        return ""
    if not dj:
        return ""
    summary = str(dj.get("summary") or "").strip()
    if not summary:
        return ""
    return f"## 笔记本级综述（多资料关系）\n\n{summary}\n\n---\n\n"


def _wrap_multi_compare_context(layered: str, planner_plan: dict[str, Any] | None) -> str:
    lines = [
        "## 多资料对比",
        "请用表格或分栏组织：各列/行对应一条资料（与 [n] 一致）；同一单元格内事实只标一个 [n]，勿混淆不同资料。",
    ]
    if planner_plan:
        axis = str(planner_plan.get("compareAxis") or "").strip()
        if axis:
            lines.append(f"比较维度：{axis}")
        for ps in planner_plan.get("perSourceFocus") or []:
            if not isinstance(ps, dict):
                continue
            idx = str(ps.get("index") or "").strip()
            focus = str(ps.get("focus") or "").strip()
            if idx and focus:
                lines.append(f"- 资料 [{idx}]：{focus}")
    lines.append("")
    return "\n".join(lines) + "\n\n---\n\n" + layered


def _prepend_multi_note_prefix(ctx: str, prefix: str) -> str:
    if not prefix or not ctx:
        return ctx
    if prefix.strip() in ctx[: min(len(ctx), 800)]:
        return ctx
    return prefix + ctx


def _low_confidence_threshold() -> float:
    try:
        return float(os.getenv("NOTES_ASK_LOW_CONFIDENCE_SCORE", "0.12") or "0.12")
    except (TypeError, ValueError):
        return 0.12


def _proactive_embed_routed_shards(
    *,
    routed_shards: list[dict[str, Any]],
    user_ref: str | None,
    api_key: str | None = None,
) -> None:
    """长文默认：对路由到的片先做 on-demand 嵌入，再走向量检索。"""
    if not proactive_on_demand_enabled() or not routed_shards:
        return
    by_note: dict[str, list[str]] = {}
    for r in routed_shards:
        nid = str(r.get("noteId") or "").strip()
        sid = str(r.get("shardId") or "").strip()
        if nid and sid:
            by_note.setdefault(nid, []).append(sid)
    for nid, sids in by_note.items():
        try:
            embed_shards_on_demand(nid, list(dict.fromkeys(sids)), user_ref=user_ref, api_key=api_key)
        except Exception as exc:
            logger.warning("proactive shard on_demand note_id=%s: %s", nid, exc)


def assess_retrieval_confidence(
    *,
    note_ids: list[str],
    rows_by_id: dict[str, dict[str, Any]],
    retrieve_obs: dict[str, Any] | None,
    retr_meta: list[dict[str, Any]] | None,
) -> bool:
    """True 表示置信度低，应提示「材料未覆盖」。"""
    for nid in note_ids:
        st = note_coverage_stats(nid, rows_by_id.get(nid))
        if st.get("ragIndexCoveragePct", 100) < 35:
            return True
    if retr_meta:
        try:
            scores = [float(x.get("score") or 0) for x in retr_meta if x.get("score")]
            if scores and max(scores) < _low_confidence_threshold():
                return True
        except (TypeError, ValueError):
            pass
    return False


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

    corpus_mode = _detect_corpus_mode(ordered, question, total_chars=total)
    allowed = ("single", "multi_compare", "multi_synthesize", "per_note")
    if corpus_mode not in allowed:
        corpus_mode = "single"

    if mode_env in ("rag", "chapter_deep", "shard_deep", "shard_direct", "long_context_direct"):
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
        shard_direct_ok = False
        shard_bar = shard_route_min_score()
        if is_very_long_doc(total):
            shard_bar *= 0.85
        if len(ordered) == 1 and routed_shards and multi_shard:
            sh0 = routed_shards[0]
            shards = list_shards(ordered[0])
            sh = next((s for s in shards if str(s.get("shard_id")) == str(sh0.get("shardId"))), None)
            if sh:
                sh_len = int(sh.get("char_end") or 0) - int(sh.get("char_start") or 0)
                if sh_len > 0 and sh_len <= shard_direct_read_max_chars() and best_shard >= shard_bar:
                    shard_direct_ok = True
        if shard_direct_ok:
            qa_mode = "shard_direct"
            grounding = "shard_direct"
        elif (
            routed_chapters
            and best_chapter >= chapter_route_min_score()
            and (
                bool(re.search(_CHAPTER_QUERY_RE, question or ""))
                or relative_chapter_intent(question) is not None
                or best_chapter >= best_shard
            )
        ):
            qa_mode = "chapter_deep"
            grounding = "chapter_deep"
        elif multi_shard and routed_shards and (
            best_shard >= shard_bar or (is_long_doc(total) and len(ordered) == 1)
        ):
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
        "corpusMode": corpus_mode,
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
    planner_plan: dict[str, Any] | None = None,
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
    corpus_mode = str(plan.get("corpusMode") or "single")
    total_chars = int(plan.get("totalChars") or 0)
    answer_type = classify_answer_type(q)
    budgets = resolve_qa_retrieval_budgets(
        answer_type,
        total_chars=total_chars,
        corpus_mode=corpus_mode,
    )
    routed_for_embed = plan.get("routedShards") or []
    if is_long_doc(total_chars) and routed_for_embed:
        _proactive_embed_routed_shards(
            routed_shards=routed_for_embed if isinstance(routed_for_embed, list) else [],
            user_ref=user_ref,
        )
    meta: dict[str, Any] = {
        "qaMode": qa_mode,
        "grounding": plan.get("grounding"),
        "corpusMode": corpus_mode,
        "routedShards": plan.get("routedShards") or [],
        "routedChapters": plan.get("routedChapters") or [],
        "coverageHint": plan.get("coverageHint") or "",
    }

    sources: list[dict[str, Any]] = []
    for i, nid in enumerate(ordered, start=1):
        row = rows.get(nid) or get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if row:
            sources.append({"index": str(i), "noteId": nid, "title": _metadata_title(row, nid)})

    digest_prefix = _build_multi_note_digest_prefix(notebook, ordered, user_ref=user_ref)
    per_note_budgets = divide_budgets_per_note(budgets, len(ordered)) if corpus_mode == "per_note" else budgets

    if qa_mode == "shard_direct" and len(ordered) == 1:
        routed_sd = plan.get("routedShards") or []
        if not routed_sd:
            qa_mode = "shard_deep"
            meta["qaMode"] = qa_mode
        else:
            nid = ordered[0]
            row = rows.get(nid) or {}
            body = str(row.get("content_text") or "")
            shards = list_shards(nid)
            sh = next(
                (s for s in shards if str(s.get("shard_id")) == str(routed_sd[0].get("shardId"))),
                None,
            )
            if sh and body:
                title = str(sh.get("title") or "")
                slice_text = shard_body_slice(body, sh, max_chars=shard_direct_read_max_chars())
                md = _metadata_dict(row)
                l0 = str(md.get("bookSummaryL0") or row.get("note_summary") or "").strip()
                blocks = []
                if l0:
                    blocks.append(f"## 全书概览\n\n{l0}")
                blocks.append(f"## {title}（本片直读）\n\n{slice_text}")
                meta["layered"] = True
                meta["qaMode"] = qa_mode
                return "\n\n---\n\n".join(blocks), sources, meta

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
            retrieval_budget=budgets["retrieval_budget"],
            user_ref=user_ref,
            api_key=None,
            chapter_routed=ch_routed
            if ch_routed
            and (
                re.search(_CHAPTER_QUERY_RE, q)
                or relative_chapter_intent(q) is not None
                or float((ch_routed[0] or {}).get("score") or 0) >= chapter_route_min_score()
            )
            else None,
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
                    summary_budget=max(6_000, budgets["summary_budget"] // 2),
                    retrieval_budget=max(8_000, budgets["retrieval_budget"] // 2),
                    top_k=min(28, top_k or 24),
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
            retrieval_budget=budgets["retrieval_budget"],
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
                    summary_budget=max(6_000, budgets["summary_budget"] // 2),
                    retrieval_budget=max(8_000, budgets["retrieval_budget"] // 2),
                    top_k=min(28, top_k or 24),
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

    if qa_mode == "rag" and corpus_mode == "per_note" and len(ordered) >= 2 and NOTE_LAYERED_RAG and q:
        blocks: list[str] = []
        combined_meta: dict[str, Any] = {"qaMode": qa_mode, "corpusMode": "per_note", "perNote": True}
        note_top_k = per_note_retrieval_top_k(top_k, len(ordered))
        for i, nid in enumerate(ordered, start=1):
            row = rows.get(nid) or {}
            title = _metadata_title(row, nid)
            layered, src_part, lmeta = build_layered_notes_context(
                notebook=notebook,
                note_ids=[nid],
                query=q,
                user_ref=user_ref,
                summary_budget=per_note_budgets["summary_budget"],
                retrieval_budget=per_note_budgets["retrieval_budget"],
                top_k=note_top_k,
                project_owner_user_uuid=project_owner_user_uuid,
            )
            if layered:
                blocks.append(f"## 资料 {i}：{title}\n\n{layered}")
                retr = lmeta.get("retrieval_chunks_meta")
                if isinstance(retr, list):
                    sources = _enrich_sources_with_chunks(sources, retr)
        if blocks:
            ctx = _prepend_multi_note_prefix(
                "## 逐篇检索（各资料独立检索；请勿混淆不同资料的事实与 [n]）\n\n---\n\n" + "\n\n---\n\n".join(blocks),
                digest_prefix,
            )
            combined_meta["lowConfidence"] = assess_retrieval_confidence(
                note_ids=ordered,
                rows_by_id=rows,
                retrieve_obs={},
                retr_meta=None,
            )
            return ctx, sources, combined_meta

    if qa_mode == "rag" and NOTE_LAYERED_RAG and q:
        sh_filter = None
        if is_long_doc(total_chars) and routed_for_embed:
            sh_filter = _shard_filter_from_routed(
                routed_for_embed if isinstance(routed_for_embed, list) else []
            )
        elif _multi_shard_notes(ordered):
            sh_filter = shard_filter_for_query(ordered, q)
        if corpus_mode == "multi_compare" and len(ordered) >= 2:
            meta["corpusMode"] = corpus_mode
        layered, sources, lmeta = build_layered_notes_context(
            notebook=notebook,
            note_ids=ordered,
            query=q,
            user_ref=user_ref,
            summary_budget=budgets["summary_budget"],
            retrieval_budget=budgets["retrieval_budget"],
            top_k=top_k or 36,
            project_owner_user_uuid=project_owner_user_uuid,
            shard_filter=sh_filter,
        )
        if layered:
            meta.update(lmeta)
            obs = lmeta.get("retrieve_obs") if isinstance(lmeta.get("retrieve_obs"), dict) else {}
            retr_m = lmeta.get("retrieval_chunks_meta")
            if isinstance(retr_m, list) and retr_m:
                sources = _enrich_sources_with_chunks(sources, retr_m)
            meta["lowConfidence"] = assess_retrieval_confidence(
                note_ids=ordered,
                rows_by_id=rows,
                retrieve_obs=obs,
                retr_meta=retr_m if isinstance(retr_m, list) else None,
            )
            if isinstance(retr_m, list) and retr_m:
                meta["retrievalChunksMeta"] = retr_m
            if corpus_mode == "multi_compare":
                layered = _wrap_multi_compare_context(layered, planner_plan)
            layered = _prepend_multi_note_prefix(layered, digest_prefix)
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
