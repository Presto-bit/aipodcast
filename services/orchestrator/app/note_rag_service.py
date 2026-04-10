"""
勾选范围内的向量检索 + 异步摘要分层（笔记入库后由 RQ 建索引）。

- 索引：按 content_text 切块、EmbeddingProvider 嵌入，写入 note_rag_chunks。
- 摘要：异步 LLM 生成，写入 inputs.note_summary。
- 问答 / 脚本参考：优先摘要 + 跨笔记向量检索 Top 块；无索引时回退旧逻辑。
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

from .db import get_conn, get_cursor
from .models import get_note_by_id
from .rag_core import _cosine, _keyword_score, split_text_into_chunks
from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)

NOTE_LAYERED_RAG = (os.getenv("NOTE_LAYERED_RAG", "1") or "").strip().lower() not in ("0", "false", "no")
MAX_CHUNKS_PER_NOTE = max(16, min(256, int(os.getenv("NOTE_RAG_MAX_CHUNKS_PER_NOTE", "160") or "160")))
_SUMMARY_INPUT_CAP = 44_000
_SUMMARY_OUTPUT_CHARS = 5000

_SUMMARY_SYSTEM = (
    "你是编辑助手。下面是一篇资料全文或长摘录。请用中文写一段结构化摘要："
    "主要观点、章节/话题脉络、关键术语；不要编造原文没有的内容。"
    "控制在约 800～1200 汉字以内，可用简短条目。"
)


def _body_sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def ensure_note_rag_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_summary TEXT")
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_rag_body_hash TEXT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS note_rag_chunks (
                  input_id UUID NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
                  chunk_index INT NOT NULL,
                  chunk_text TEXT NOT NULL,
                  embedding JSONB NOT NULL,
                  PRIMARY KEY (input_id, chunk_index)
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_note_rag_chunks_input ON note_rag_chunks (input_id)"
            )
            conn.commit()


def _invoke_llm_summary(user_text: str, api_key: str | None) -> str:
    text, _tid = invoke_llm_chat_messages_with_minimax_fallback(
        [
            {"role": "system", "content": _SUMMARY_SYSTEM},
            {"role": "user", "content": user_text[:_SUMMARY_INPUT_CAP]},
        ],
        temperature=0.35,
        api_key=api_key,
        timeout_sec=120,
    )
    return text


def delete_rag_chunks_for_note(note_id: str) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("DELETE FROM note_rag_chunks WHERE input_id = %s::uuid", (note_id,))
            conn.commit()


def count_rag_chunks_for_notes(note_ids: list[str]) -> int:
    if not note_ids:
        return 0
    ids = [str(x).strip() for x in note_ids if str(x).strip()]
    if not ids:
        return 0
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS c FROM note_rag_chunks
                WHERE input_id = ANY(%s::uuid[])
                """,
                (ids,),
            )
            row = cur.fetchone()
            return int(row["c"] or 0) if row else 0


def _load_chunks_for_notes(note_ids: list[str]) -> list[dict[str, Any]]:
    ids = [str(x).strip() for x in note_ids if str(x).strip()]
    if not ids:
        return []
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT input_id::text AS note_id, chunk_index, chunk_text, embedding
                FROM note_rag_chunks
                WHERE input_id = ANY(%s::uuid[])
                ORDER BY input_id, chunk_index
                """,
                (ids,),
            )
            return [dict(r) for r in cur.fetchall()]


def _update_note_rag_meta(note_id: str, summary: str | None, body_hash: str) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE inputs
                SET note_summary = %s, note_rag_body_hash = %s
                WHERE id = %s::uuid
                """,
                (summary, body_hash, note_id),
            )
            conn.commit()


def index_note_for_rag(note_id: str, user_ref: str | None, api_key: str | None = None) -> dict[str, Any]:
    """
    切块 + 嵌入 + 摘要；幂等（正文 hash 未变则跳过）。
    """
    row = get_note_by_id(note_id, user_ref=user_ref)
    if not row:
        return {"ok": False, "error": "note_not_found"}
    body = str(row.get("content_text") or "").strip()
    if len(body) < 80:
        delete_rag_chunks_for_note(note_id)
        _update_note_rag_meta(note_id, None, "")
        return {"ok": True, "skipped": "body_too_short", "chars": len(body)}

    h = _body_sha256(body)
    prev = str(row.get("note_rag_body_hash") or "").strip()
    if prev == h and count_rag_chunks_for_notes([note_id]) > 0:
        return {"ok": True, "skipped": "unchanged", "chunks": count_rag_chunks_for_notes([note_id])}

    chunks = split_text_into_chunks(body)[:MAX_CHUNKS_PER_NOTE]
    if not chunks:
        return {"ok": False, "error": "no_chunks"}

    emb_backend = "unknown"
    try:
        from app.fyv_shared.embedding_provider import EmbeddingProvider

        ep = EmbeddingProvider()
        emb_backend = ep.active_backend()
        embeddings: list[list[float]] = []
        batch = 32
        for i in range(0, len(chunks), batch):
            embeddings.extend(ep.embed_texts([c[:8000] for c in chunks[i : i + batch]]))
    except Exception as exc:
        logger.warning("note_rag embed failed note_id=%s: %s", note_id, exc)
        return {"ok": False, "error": f"embed_failed:{exc}"[:200]}

    if len(embeddings) != len(chunks):
        return {"ok": False, "error": "embed_count_mismatch"}

    delete_rag_chunks_for_note(note_id)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            for idx, (ch, emb) in enumerate(zip(chunks, embeddings)):
                cur.execute(
                    """
                    INSERT INTO note_rag_chunks (input_id, chunk_index, chunk_text, embedding)
                    VALUES (%s::uuid, %s, %s, %s::jsonb)
                    """,
                    (note_id, idx, ch, json.dumps(emb)),
                )
            conn.commit()

    summary_text = ""
    try:
        summary_text = _invoke_llm_summary(body, api_key=api_key)[:_SUMMARY_OUTPUT_CHARS]
    except Exception as exc:
        logger.warning("note_rag summary failed note_id=%s: %s", note_id, exc)
        summary_text = ""

    _update_note_rag_meta(note_id, summary_text or None, h)
    return {
        "ok": True,
        "chunks": len(chunks),
        "summary_chars": len(summary_text),
        "embedding_backend": emb_backend,
    }


def _metadata_title(row: dict[str, Any], note_id: str) -> str:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    if not isinstance(md, dict):
        return note_id
    return str(md.get("title") or note_id).strip() or note_id


def _metadata_notebook(row: dict[str, Any]) -> str:
    md = row.get("metadata") or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except Exception:
            md = {}
    if not isinstance(md, dict):
        return ""
    return str(md.get("notebook") or "").strip()


def _note_rag_keyword_prefilter_cap(note_count: int, top_k: int) -> int:
    """关键词粗排保留条数：显著少于全量块时再走向量精排，降低 CPU。"""
    mult = max(8, min(80, int(os.getenv("NOTE_RAG_KEYWORD_PREFILTER_MULT", "24") or "24")))
    floor = max(64, min(800, int(os.getenv("NOTE_RAG_KEYWORD_PREFILTER_FLOOR", "200") or "200")))
    cap = max(floor, top_k * mult, note_count * 24)
    max_cap = max(200, min(4000, int(os.getenv("NOTE_RAG_KEYWORD_PREFILTER_MAX", "1400") or "1400")))
    return min(max_cap, cap)


def _batch_cosine_vs_query(qv: list[float], vectors: list[list[float]]) -> list[float]:
    """批量余弦相似度；优先 numpy，否则逐对回退。"""
    if not vectors:
        return []
    try:
        import numpy as np

        q = np.asarray(qv, dtype=np.float32)
        qn = float(np.linalg.norm(q))
        if qn <= 1e-12:
            return [0.0] * len(vectors)
        m = np.asarray(vectors, dtype=np.float32)
        mn = np.linalg.norm(m, axis=1)
        dots = m @ q
        denom = mn * qn
        with np.errstate(divide="ignore", invalid="ignore"):
            sims = np.divide(dots, denom, out=np.zeros_like(dots, dtype=np.float64), where=denom > 1e-12)
        return [float(x) for x in sims]
    except Exception:
        return [_cosine(qv, v) for v in vectors]


def retrieve_chunks_across_notes(
    *,
    note_ids: list[str],
    query: str,
    max_chars: int,
    top_k: int = 32,
) -> tuple[str, list[dict[str, Any]]]:
    """对已索引块：关键词粗排缩小候选，再对 query 嵌入并批量余弦，取 Top-K 后按预算拼上下文。"""
    q = (query or "").strip()
    rows = _load_chunks_for_notes(note_ids)
    if not rows or not q:
        return "", []

    parsed: list[dict[str, Any]] = []
    for r in rows:
        emb = r.get("embedding")
        if isinstance(emb, str):
            try:
                emb = json.loads(emb)
            except Exception:
                continue
        if not isinstance(emb, list) or not emb:
            continue
        ch = str(r.get("chunk_text") or "").strip()
        if not ch:
            continue
        vec = [float(x) for x in emb]
        parsed.append({**r, "_vec": vec, "_ch": ch})

    if not parsed:
        return "", []

    pref_cap = _note_rag_keyword_prefilter_cap(len(note_ids), top_k)
    if len(parsed) > pref_cap:
        scored_kw = [(float(_keyword_score(q, p["_ch"])), p) for p in parsed]
        scored_kw.sort(key=lambda x: -x[0])
        parsed = [p for _, p in scored_kw[:pref_cap]]

    try:
        from app.fyv_shared.embedding_provider import EmbeddingProvider

        ep = EmbeddingProvider()
        qv = ep.embed_texts([q[:8000]])[0]
    except Exception as exc:
        logger.warning("retrieve query embed failed: %s", exc)
        return "", []

    vectors = [p["_vec"] for p in parsed]
    sims = _batch_cosine_vs_query(qv, vectors)
    scored: list[tuple[float, dict[str, Any]]] = []
    for sim, p in zip(sims, parsed):
        row = {k: v for k, v in p.items() if not str(k).startswith("_")}
        scored.append((float(sim), row))

    scored.sort(key=lambda x: -x[0])
    k = max(1, min(top_k, len(scored)))
    picked = scored[:k]

    parts: list[str] = []
    used = 0
    meta_out: list[dict[str, Any]] = []
    budget = max(2000, min(int(max_chars), 200_000))
    for score, r in picked:
        nid = str(r.get("note_id") or "")
        idx = int(r.get("chunk_index") or 0)
        ch = str(r.get("chunk_text") or "").strip()
        if not ch:
            continue
        header = f"【检索片段 note={nid} chunk={idx} score={score:.4f}】\n"
        piece = header + ch
        if used + len(piece) + 2 <= budget:
            parts.append(piece)
            used += len(piece) + 2
            meta_out.append({"noteId": nid, "chunkIndex": str(idx), "score": f"{score:.4f}"})
        else:
            remain = budget - used - len(header) - 40
            if remain > 200:
                parts.append(header + ch[:remain] + "\n【…块内截断…】")
            break

    return "\n\n".join(parts).strip(), meta_out


def build_summaries_section(
    *,
    ordered_ids: list[str],
    user_ref: str | None,
    max_chars: int,
) -> str:
    parts: list[str] = []
    used = 0
    for i, nid in enumerate(ordered_ids, start=1):
        row = get_note_by_id(nid, user_ref=user_ref)
        if not row:
            continue
        title = _metadata_title(row, nid)
        s = str(row.get("note_summary") or "").strip()
        if not s:
            continue
        block = f"### 摘要 [{i}] {title}\nnoteId: {nid}\n\n{s}"
        if used + len(block) + 4 > max_chars:
            break
        parts.append(block)
        used += len(block) + 4
    if not parts:
        return ""
    return "## 异步摘要（每条笔记一份，便于把握全书脉络）\n\n" + "\n\n---\n\n".join(parts)


def build_layered_notes_context(
    *,
    notebook: str,
    note_ids: list[str],
    query: str,
    user_ref: str | None,
    summary_budget: int,
    retrieval_budget: int,
    top_k: int = 36,
) -> tuple[str | None, list[dict[str, str]], dict[str, Any]]:
    """
    若勾选范围内无任何索引块，返回 (None, [], meta) 表示应回退旧逻辑。
    否则返回 (context, sources, meta)。
    """
    meta: dict[str, Any] = {"layered": True, "chunks_indexed": 0}
    nb = notebook.strip()
    if not nb:
        raise ValueError("notebook_required")

    seen: set[str] = set()
    ordered: list[str] = []
    for raw_id in note_ids:
        nid = str(raw_id or "").strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        ordered.append(nid)
    if not ordered:
        raise ValueError("note_ids_required")

    sources: list[dict[str, str]] = []
    for i, nid in enumerate(ordered, start=1):
        row = get_note_by_id(nid, user_ref=user_ref)
        if not row:
            raise ValueError("note_not_found")
        if _metadata_notebook(row) != nb:
            raise ValueError("note_notebook_mismatch")
        title = _metadata_title(row, nid)
        sources.append({"index": str(i), "noteId": nid, "title": title})

    n_chunks = count_rag_chunks_for_notes(ordered)
    meta["chunks_indexed"] = n_chunks
    if n_chunks == 0:
        return None, [], meta

    sum_part = build_summaries_section(
        ordered_ids=ordered, user_ref=user_ref, max_chars=summary_budget
    )
    retr, retr_meta = retrieve_chunks_across_notes(
        note_ids=ordered,
        query=query,
        max_chars=retrieval_budget,
        top_k=top_k,
    )
    meta["retrieval_chunks"] = len(retr_meta)

    blocks: list[str] = []
    if sum_part:
        blocks.append(sum_part)
    if retr:
        blocks.append("## 与问题相关的原文摘录（向量检索，勾选范围内）\n\n" + retr)

    ctx = "\n\n---\n\n".join(blocks).strip()
    if not ctx:
        return None, [], meta

    return ctx, sources, meta


def build_layered_reference_block(
    *,
    note_ids: list[str],
    query_hint: str,
    user_ref: str | None,
    summary_budget: int,
    retrieval_budget: int,
    top_k: int = 40,
) -> tuple[str | None, dict[str, Any]]:
    """供 merge_reference_for_script：无 notebook 校验，仅按 note id 列表。"""
    meta: dict[str, Any] = {"layered_ref": True}
    ordered = [str(x).strip() for x in note_ids if str(x).strip()]
    if not ordered:
        return None, meta
    n_chunks = count_rag_chunks_for_notes(ordered)
    meta["chunks_indexed"] = n_chunks
    if n_chunks == 0:
        return None, meta

    sum_part = build_summaries_section(
        ordered_ids=ordered, user_ref=user_ref, max_chars=summary_budget
    )
    retr, _rm = retrieve_chunks_across_notes(
        note_ids=ordered,
        query=query_hint,
        max_chars=retrieval_budget,
        top_k=top_k,
    )
    blocks: list[str] = []
    if sum_part:
        blocks.append(sum_part)
    if retr:
        blocks.append("## 与任务相关的原文摘录（向量检索，勾选笔记范围内）\n\n" + retr)
    ctx = "\n\n---\n\n".join(blocks).strip()
    if not ctx:
        return None, meta
    meta["retrieval_chars"] = len(retr)
    meta["summary_chars"] = len(sum_part)
    return ctx, meta
