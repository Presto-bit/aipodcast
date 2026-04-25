"""
勾选范围内的向量检索 + 异步摘要分层（笔记入库后由 RQ 建索引）。

- 索引：按 content_text 切块、EmbeddingProvider 嵌入，写入 note_rag_chunks；
  inputs.note_rag_embedding_sig 记录 backend|dim|配置指纹，变更 env 后过期块检索时丢弃。
- inputs.note_rag_index_error：最近一次索引失败原因（成功时清空）。
- 摘要：异步 LLM 生成，写入 inputs.note_summary（标注为机器摘要）。
- 问答 / 脚本参考：优先摘要 + 跨笔记向量检索 Top 块；无索引时回退旧逻辑。
- 跨笔记：关键词/向量候选池按笔记均衡合并（避免单篇挤掉他篇）；Top-K 在多篇时轮询各篇高分块后再按全局分数补足，输出顺序与分数一致。
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from collections import defaultdict
from typing import Any

from .db import get_conn, get_cursor
from .notes_ask_profile import notes_ask_profile_emit
from .models import get_note_by_id
from .rag_core import _cosine, _keyword_score, decompose_retrieval_queries, split_text_into_chunks
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
    "摘要仅供快速浏览，事实与细节以原文为准。"
)


def _body_sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def ensure_note_rag_schema() -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_summary TEXT")
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_rag_body_hash TEXT")
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_rag_embedding_sig TEXT")
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_rag_index_error TEXT")
            cur.execute("ALTER TABLE inputs ADD COLUMN IF NOT EXISTS note_rag_index_at TIMESTAMPTZ")
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


def _load_chunk_rows_light(note_ids: list[str]) -> list[dict[str, Any]]:
    """仅加载块文本与索引（不含 embedding），供关键词粗排后再按需取向量。"""
    ids = [str(x).strip() for x in note_ids if str(x).strip()]
    if not ids:
        return []
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT n.input_id::text AS note_id, n.chunk_index, n.chunk_text,
                       i.note_rag_embedding_sig AS note_sig
                FROM note_rag_chunks n
                JOIN inputs i ON i.id = n.input_id
                WHERE n.input_id = ANY(%s::uuid[])
                ORDER BY n.input_id, n.chunk_index
                """,
                (ids,),
            )
            return [dict(r) for r in cur.fetchall()]


def _load_embeddings_by_pairs(pairs: list[tuple[str, int]]) -> dict[tuple[str, int], list[float]]:
    """按 (note_id, chunk_index) 批量加载向量，避免先把笔记本下全部块向量读进内存。"""
    out: dict[tuple[str, int], list[float]] = {}
    if not pairs:
        return out
    seen: set[tuple[str, int]] = set()
    deduped: list[tuple[str, int]] = []
    for nid, idx in pairs:
        key = (str(nid).strip(), int(idx))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    batch_n = max(50, min(800, int(os.getenv("NOTE_RAG_EMB_BATCH", "500") or "500")))
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            for bi in range(0, len(deduped), batch_n):
                batch = deduped[bi : bi + batch_n]
                uuids = [b[0] for b in batch]
                idxs = [b[1] for b in batch]
                cur.execute(
                    """
                    SELECT n.input_id::text AS note_id, n.chunk_index, n.embedding
                    FROM note_rag_chunks n
                    INNER JOIN (
                        SELECT * FROM unnest(%s::uuid[], %s::int[]) AS p(input_id, chunk_index)
                    ) pr ON pr.input_id = n.input_id AND pr.chunk_index = n.chunk_index
                    """,
                    (uuids, idxs),
                )
                for r in cur.fetchall():
                    emb = r.get("embedding")
                    if isinstance(emb, str):
                        try:
                            emb = json.loads(emb)
                        except Exception:
                            continue
                    if not isinstance(emb, list) or not emb:
                        continue
                    key2 = (str(r.get("note_id") or "").strip(), int(r.get("chunk_index") or 0))
                    out[key2] = [float(x) for x in emb]
    return out


def _update_note_rag_after_success(
    note_id: str,
    summary: str | None,
    body_hash: str,
    embedding_sig: str,
) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE inputs
                SET note_summary = %s, note_rag_body_hash = %s,
                    note_rag_embedding_sig = %s, note_rag_index_error = NULL,
                    note_rag_index_at = NOW()
                WHERE id = %s::uuid
                """,
                (summary, body_hash, embedding_sig, note_id),
            )
            conn.commit()


def _update_note_rag_index_error(note_id: str, error: str) -> None:
    err = (error or "").strip()[:500]
    if not err:
        return
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE inputs SET note_rag_index_error = %s WHERE id = %s::uuid
                """,
                (err, note_id),
            )
            conn.commit()


def _clear_note_rag_meta_short_body(note_id: str) -> None:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE inputs
                SET note_summary = NULL, note_rag_body_hash = %s,
                    note_rag_embedding_sig = NULL, note_rag_index_error = NULL,
                    note_rag_index_at = NULL
                WHERE id = %s::uuid
                """,
                ("", note_id),
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
        _clear_note_rag_meta_short_body(note_id)
        return {"ok": True, "skipped": "body_too_short", "chars": len(body)}

    h = _body_sha256(body)
    prev = str(row.get("note_rag_body_hash") or "").strip()
    if prev == h and count_rag_chunks_for_notes([note_id]) > 0:
        return {"ok": True, "skipped": "unchanged", "chunks": count_rag_chunks_for_notes([note_id])}

    chunks = split_text_into_chunks(body)[:MAX_CHUNKS_PER_NOTE]
    if not chunks:
        _update_note_rag_index_error(note_id, "no_chunks")
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
        _update_note_rag_index_error(note_id, f"embed_failed:{exc}")
        return {"ok": False, "error": f"embed_failed:{exc}"[:200]}

    if len(embeddings) != len(chunks):
        _update_note_rag_index_error(note_id, "embed_count_mismatch")
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

    sig = ""
    try:
        sig = ep.embedding_signature(len(embeddings[0]))
    except Exception:
        sig = ""

    summary_text = ""
    try:
        summary_text = _invoke_llm_summary(body, api_key=api_key)[:_SUMMARY_OUTPUT_CHARS]
    except Exception as exc:
        logger.warning("note_rag summary failed note_id=%s: %s", note_id, exc)
        summary_text = ""

    _update_note_rag_after_success(note_id, summary_text or None, h, sig or "")
    return {
        "ok": True,
        "chunks": len(chunks),
        "summary_chars": len(summary_text),
        "embedding_backend": emb_backend,
        "embedding_sig": sig[:120] if sig else "",
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


def _chunk_allowed_for_embedding(
    note_sig: Any,
    vec: list[float],
    qv: list[float],
    current_sig: str,
) -> bool:
    """维度一致；若笔记存了 sig 则须与当前 embedding 配置一致（否则视为需重索引的过期向量）。"""
    if len(vec) != len(qv):
        return False
    ns = (note_sig or "").strip() if isinstance(note_sig, str) else ""
    if not ns:
        return True
    return ns == current_sig


def _note_rag_vector_candidate_cap() -> int:
    """向量精排前候选块硬上限，防止勾选过多笔记时 CPU/内存尖峰。"""
    return max(200, min(8000, int(os.getenv("NOTE_RAG_VECTOR_CANDIDATE_CAP", "2500") or "2500")))


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


def _multi_query_enabled() -> bool:
    return (os.getenv("NOTE_RAG_MULTI_QUERY", "1") or "").strip().lower() not in ("0", "false", "no")


def _max_subqueries() -> int:
    try:
        return max(1, min(5, int(os.getenv("NOTE_RAG_MAX_SUBQUERIES", "3") or "3")))
    except (TypeError, ValueError):
        return 3


def _note_rag_fairness_enabled() -> bool:
    return (os.getenv("NOTE_RAG_NOTE_FAIRNESS", "1") or "").strip().lower() not in ("0", "false", "no")


def _note_rag_balanced_prefilter_enabled() -> bool:
    return (os.getenv("NOTE_RAG_BALANCED_PREFILTER", "1") or "").strip().lower() not in ("0", "false", "no")


def _kw_score_chunk(q: str, p: dict[str, Any]) -> float:
    return float(_keyword_score(q, p["_ch"]))


def _balanced_pool_by_note_keyword(
    parsed: list[dict[str, Any]],
    q: str,
    ordered_note_ids: list[str],
    total_cap: int,
) -> list[dict[str, Any]]:
    """
    P1：在总条数上限内，每篇笔记先保留若干关键词最高分块再合并，避免全局粗筛时整篇被挤掉。
    """
    if len(parsed) <= total_cap:
        return parsed
    by_note: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in parsed:
        nid = str(p.get("note_id") or "").strip()
        if nid:
            by_note[nid].append(p)

    min_per = max(4, min(128, int(os.getenv("NOTE_RAG_PER_NOTE_PREFILTER_MIN", "8") or "8")))
    seen_n: set[str] = set()
    order: list[str] = []
    for raw in ordered_note_ids:
        nid = str(raw or "").strip()
        if nid and nid in by_note and nid not in seen_n:
            order.append(nid)
            seen_n.add(nid)
    for nid in sorted(by_note.keys()):
        if nid not in seen_n:
            order.append(nid)

    n = max(1, len(order))
    per = max(min_per, total_cap // n)
    pool: list[dict[str, Any]] = []
    for nid in order:
        chunks = by_note[nid]
        chunks.sort(key=lambda x: -_kw_score_chunk(q, x))
        pool.extend(chunks[:per])
    if len(pool) <= total_cap:
        return pool
    pool.sort(key=lambda x: -_kw_score_chunk(q, x))
    return pool[:total_cap]


def _chunk_identity(row: dict[str, Any]) -> tuple[str, int]:
    return (str(row.get("note_id") or ""), int(row.get("chunk_index") or 0))


def _note_rag_mmr_enabled() -> bool:
    return (os.getenv("NOTE_RAG_MMR", "1") or "").strip().lower() not in ("0", "false", "no")


def _mmr_rerank_head(
    head_rr: list[tuple[float, dict[str, Any]]],
    vec_map: dict[tuple[str, int], list[float]],
    *,
    lambda_mult: float,
) -> list[tuple[float, dict[str, Any]]] | None:
    """对 rerank 后的候选池做 MMR 重排，降低相邻高分块语义重复（需每块均有向量）。失败时返回 None。"""
    if len(head_rr) <= 1:
        return None
    items: list[tuple[float, dict[str, Any], list[float]]] = []
    for sim, row in head_rr:
        ident = _chunk_identity(row)
        v = vec_map.get(ident)
        if not v:
            return None
        items.append((sim, row, v))
    n = len(items)
    selected: list[int] = []
    remaining = set(range(n))
    first_i = max(remaining, key=lambda i: items[i][0])
    selected.append(first_i)
    remaining.remove(first_i)
    lam = float(lambda_mult)
    lam = max(0.0, min(1.0, lam))
    while remaining:
        best_i: int | None = None
        best_score = -1e300
        for i in remaining:
            sim_q = items[i][0]
            max_sim_sel = 0.0
            for j in selected:
                max_sim_sel = max(max_sim_sel, float(_cosine(items[i][2], items[j][2])))
            mmr = lam * sim_q - (1.0 - lam) * max_sim_sel
            if mmr > best_score:
                best_score = mmr
                best_i = i
        if best_i is None:
            break
        selected.append(best_i)
        remaining.remove(best_i)
    return [(items[i][0], items[i][1]) for i in selected]


def _pick_top_k_note_fairness(
    scored: list[tuple[float, dict[str, Any]]],
    top_k: int,
    ordered_note_ids: list[str],
) -> list[tuple[float, dict[str, Any]]]:
    """
    P0：多篇笔记时在各篇之间轮询取最高相似块，再从未入选的块中按全局分数降序补足 top_k；
    单篇时按分数降序取前 top_k。
    """
    k = max(1, min(top_k, len(scored)))
    if not _note_rag_fairness_enabled() or k <= 1:
        return scored[:k]

    by_note: dict[str, list[tuple[float, dict[str, Any]]]] = defaultdict(list)
    for sim, row in scored:
        nid = str(row.get("note_id") or "").strip()
        by_note[nid].append((sim, row))
    for nid in by_note:
        by_note[nid].sort(key=lambda x: -x[0])

    seen_notes = {str(x).strip() for x in ordered_note_ids if str(x).strip()}
    if len(seen_notes) <= 1 and len(by_note) <= 1:
        return scored[:k]

    order: list[str] = []
    seen_o: set[str] = set()
    for raw in ordered_note_ids:
        nid = str(raw or "").strip()
        if nid and nid in by_note and nid not in seen_o:
            order.append(nid)
            seen_o.add(nid)
    for nid in sorted(by_note.keys()):
        if nid not in seen_o:
            order.append(nid)

    picked: list[tuple[float, dict[str, Any]]] = []
    seen_chunk: set[tuple[str, int]] = set()
    ptr = {nid: 0 for nid in order if nid in by_note}

    while len(picked) < k:
        progressed = False
        for nid in order:
            if nid not in by_note:
                continue
            i = ptr.get(nid, 0)
            if i >= len(by_note[nid]):
                continue
            cand = by_note[nid][i]
            ptr[nid] = i + 1
            ident = _chunk_identity(cand[1])
            if ident in seen_chunk:
                continue
            seen_chunk.add(ident)
            picked.append(cand)
            progressed = True
            if len(picked) >= k:
                break
        if not progressed:
            break

    if len(picked) < k:
        for sim, row in scored:
            if len(picked) >= k:
                break
            ident = _chunk_identity(row)
            if ident in seen_chunk:
                continue
            seen_chunk.add(ident)
            picked.append((sim, row))

    return picked[:k]


def _note_source_index_map(note_ids: list[str]) -> dict[str, str]:
    """与 build_layered_notes_context 中 sources 序号一致：第 1 条笔记为「1」。"""
    out: dict[str, str] = {}
    seen: set[str] = set()
    for raw in note_ids:
        nid = str(raw or "").strip()
        if not nid or nid in seen:
            continue
        seen.add(nid)
        out[nid] = str(len(seen))
    return out


def retrieve_chunks_across_notes(
    *,
    note_ids: list[str],
    query: str,
    max_chars: int,
    top_k: int = 32,
    notes_ask_fast_path: bool = False,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """对已索引块：先轻量读块文本 → 关键词粗排 → 仅对候选批量取向量 → 多子查询向量 max-pool → 重排 → Top-K。

    历史上「先全量 SELECT embedding」会在块数多时严重拖慢首包（与单篇笔记字数无直接关系）。
    `notes_ask_fast_path`：知识库向资料提问专用，默认单查询嵌入、较小 rerank 池、仅用本地 hybrid 重排（跳过 Cohere HTTP）。
    """
    _t_total = time.perf_counter()
    q = (query or "").strip()
    rows = _load_chunk_rows_light(note_ids)
    light_rows_n = len(rows)
    if not rows or not q:
        notes_ask_profile_emit(
            "rag_retrieve_total_ms",
            (time.perf_counter() - _t_total) * 1000.0,
            reason="empty_query_or_no_rows",
            chunk_rows=light_rows_n,
        )
        return "", [], {"reason": "empty_query_or_no_rows"}

    parsed: list[dict[str, Any]] = []
    for r in rows:
        ch = str(r.get("chunk_text") or "").strip()
        if not ch:
            continue
        parsed.append(
            {
                "note_id": r.get("note_id"),
                "chunk_index": r.get("chunk_index"),
                "chunk_text": ch,
                "_ch": ch,
                "note_sig": r.get("note_sig"),
            }
        )

    if not parsed:
        notes_ask_profile_emit(
            "rag_retrieve_total_ms",
            (time.perf_counter() - _t_total) * 1000.0,
            reason="no_parsed_chunks",
            chunk_rows=light_rows_n,
        )
        return "", [], {"reason": "no_parsed_chunks"}

    notes_ask_profile_emit(
        "rag_retrieve_load_parse_ms",
        (time.perf_counter() - _t_total) * 1000.0,
        chunk_rows=light_rows_n,
        parsed_n=len(parsed),
    )
    _t_embed = time.perf_counter()
    try:
        from app.fyv_shared.embedding_provider import EmbeddingProvider

        ep = EmbeddingProvider()
        if notes_ask_fast_path:
            subqs = [q]
        elif _multi_query_enabled():
            subqs = decompose_retrieval_queries(q, max_queries=_max_subqueries())
        else:
            subqs = [q]
        uniq: list[str] = []
        seen_q: set[str] = set()
        for s in subqs:
            t = (s or "").strip()
            if not t or t in seen_q:
                continue
            seen_q.add(t)
            uniq.append(t)
        if not uniq:
            uniq = [q]
        qvs = ep.embed_texts([x[:8000] for x in uniq])
        if not qvs:
            raise RuntimeError("empty query embeddings")
        current_sig = ep.embedding_signature(len(qvs[0]))
        emb_backend = ep.active_backend()
    except Exception as exc:
        logger.warning("retrieve query embed failed: %s", exc)
        notes_ask_profile_emit(
            "rag_retrieve_total_ms",
            (time.perf_counter() - _t_total) * 1000.0,
            reason="query_embed_failed",
            error=str(exc)[:120],
        )
        return "", [], {"reason": "query_embed_failed", "error": str(exc)[:200]}

    notes_ask_profile_emit(
        "rag_retrieve_query_embed_ms",
        (time.perf_counter() - _t_embed) * 1000.0,
        subqueries=len(uniq),
        emb_backend=emb_backend,
    )
    _t_pref = time.perf_counter()
    src_idx_map = _note_source_index_map(note_ids)

    pref_cap = _note_rag_keyword_prefilter_cap(len(note_ids), top_k)
    if len(parsed) > pref_cap:
        if _note_rag_balanced_prefilter_enabled() and len(note_ids) > 1:
            parsed = _balanced_pool_by_note_keyword(parsed, q, note_ids, pref_cap)
        else:
            scored_kw = [(float(_keyword_score(q, p["_ch"])), p) for p in parsed]
            scored_kw.sort(key=lambda x: -x[0])
            parsed = [p for _, p in scored_kw[:pref_cap]]

    vec_cap = _note_rag_vector_candidate_cap()
    if len(parsed) > vec_cap:
        if _note_rag_balanced_prefilter_enabled() and len(note_ids) > 1:
            parsed = _balanced_pool_by_note_keyword(parsed, q, note_ids, vec_cap)
        else:
            scored_kw2 = [(float(_keyword_score(q, p["_ch"])), p) for p in parsed]
            scored_kw2.sort(key=lambda x: -x[0])
            parsed = [p for _, p in scored_kw2[:vec_cap]]

    pairs = [(str(p["note_id"]), int(p["chunk_index"])) for p in parsed]
    emb_map = _load_embeddings_by_pairs(pairs)
    notes_ask_profile_emit(
        "rag_retrieve_prefilter_load_emb_ms",
        (time.perf_counter() - _t_pref) * 1000.0,
        pairs_requested=len(pairs),
        emb_rows_loaded=len(emb_map),
    )
    _t_score = time.perf_counter()
    filtered: list[dict[str, Any]] = []
    dropped_stale = 0
    dropped_missing_emb = 0
    for p in parsed:
        key = (str(p["note_id"]), int(p["chunk_index"]))
        emb_list = emb_map.get(key)
        if emb_list is None:
            dropped_missing_emb += 1
            continue
        if not _chunk_allowed_for_embedding(p.get("note_sig"), emb_list, qvs[0], current_sig):
            dropped_stale += 1
            continue
        filtered.append({**p, "_vec": emb_list})
    parsed = filtered
    if dropped_stale:
        logger.info("note_rag retrieve dropped %s stale or dim-mismatch chunks", dropped_stale)
    if dropped_missing_emb:
        logger.info("note_rag retrieve dropped %s chunks missing embedding row", dropped_missing_emb)
    if not parsed:
        notes_ask_profile_emit(
            "rag_retrieve_total_ms",
            (time.perf_counter() - _t_total) * 1000.0,
            reason="all_stale_chunks",
            dropped_stale=dropped_stale,
            dropped_missing_emb=dropped_missing_emb,
        )
        return "", [], {
            "reason": "all_stale_chunks",
            "dropped_stale_chunks": dropped_stale,
            "dropped_missing_emb": dropped_missing_emb,
        }

    vecs = [p["_vec"] for p in parsed]
    sims = _batch_cosine_vs_query(qvs[0], vecs)
    for qv in qvs[1:]:
        extra = _batch_cosine_vs_query(qv, vecs)
        sims = [max(a, b) for a, b in zip(sims, extra)]
    scored: list[tuple[float, dict[str, Any]]] = []
    for sim, p in zip(sims, parsed):
        row = {k: v for k, v in p.items() if not str(k).startswith("_")}
        scored.append((float(sim), row))

    scored.sort(key=lambda x: -x[0])
    try:
        pool_default = int(os.getenv("NOTE_RAG_RERANK_POOL", "96") or "96")
    except (TypeError, ValueError):
        pool_default = 96
    if notes_ask_fast_path:
        pool_default = min(pool_default, 64)
    try:
        pool_n = min(len(scored), max(top_k * 2, pool_default))
    except (TypeError, ValueError):
        pool_n = min(len(scored), max(top_k * 2, 96))
    head = scored[:pool_n]
    tail = scored[pool_n:]
    if notes_ask_fast_path:
        from app.fyv_shared.rerank_provider import hybrid_lexical_rerank, _hybrid_weights

        w_v, w_k = _hybrid_weights()
        head_rr = hybrid_lexical_rerank(q, head, w_v=w_v, w_k=w_k)
        rerank_mode = "hybrid_notes_ask_fast"
    else:
        from app.fyv_shared.rerank_provider import rerank_retrieval_candidates

        head_rr, rerank_mode = rerank_retrieval_candidates(q, head)
    mmr_applied = False
    if _note_rag_mmr_enabled() and head_rr and qvs:
        try:
            lam = float(os.getenv("NOTE_RAG_MMR_LAMBDA", "0.65") or "0.65")
        except (TypeError, ValueError):
            lam = 0.65
        vec_map: dict[tuple[str, int], list[float]] = {}
        for p in parsed:
            ident = (str(p.get("note_id") or ""), int(p.get("chunk_index") or 0))
            v = p.get("_vec")
            if isinstance(v, list) and v:
                vec_map[ident] = v
        head_mmr = _mmr_rerank_head(head_rr, vec_map, lambda_mult=lam)
        if head_mmr is not None:
            head_rr = head_mmr
            mmr_applied = True
    scored_for_pick = head_rr + tail
    picked = _pick_top_k_note_fairness(scored_for_pick, top_k, note_ids)
    notes_ask_profile_emit(
        "rag_retrieve_score_rerank_pick_ms",
        (time.perf_counter() - _t_score) * 1000.0,
        rerank_mode=rerank_mode,
        top_k=top_k,
        vector_candidates=len(vecs),
    )
    _t_fmt = time.perf_counter()

    obs: dict[str, Any] = {
        "notes_ask_fast_path": notes_ask_fast_path,
        "embedding_backend": emb_backend,
        "multi_query_embedded": len(uniq),
        "keyword_pref_cap": pref_cap,
        "vec_cap": vec_cap,
        "chunks_light_rows": light_rows_n,
        "vector_candidates": len(parsed),
        "emb_rows_loaded": len(emb_map),
        "dropped_stale_chunks": dropped_stale,
        "dropped_missing_emb": dropped_missing_emb,
        "rerank_pool": pool_n,
        "rerank_mode": rerank_mode,
        "mmr_applied": mmr_applied,
        "top_k": top_k,
    }
    try:
        logger.info("note_rag_retrieve %s", json.dumps(obs, ensure_ascii=False)[:1600])
    except Exception:
        logger.info("note_rag_retrieve emb=%s subq=%s rerank=%s", emb_backend, len(uniq), rerank_mode)

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
        src_label = src_idx_map.get(nid, "?")
        # 仅用「资料序号」标头，避免模型复述 chunk= / score= 等技术词到用户回答里
        header = f"【摘录·与问题相关的原文（资料第 {src_label} 条）】\n"
        piece = header + ch
        if used + len(piece) + 2 <= budget:
            parts.append(piece)
            used += len(piece) + 2
            excerpt = ch if len(ch) <= 4000 else ch[:4000] + "…"
            meta_out.append(
                {
                    "noteId": nid,
                    "chunkIndex": str(idx),
                    "score": f"{score:.4f}",
                    "excerpt": excerpt,
                }
            )
        else:
            remain = budget - used - len(header) - 40
            if remain > 200:
                tail = ch[:remain] + "\n【…块内截断…】"
                parts.append(header + tail)
                tail_ex = tail if len(tail) <= 4000 else tail[:4000] + "…"
                meta_out.append(
                    {
                        "noteId": nid,
                        "chunkIndex": str(idx),
                        "score": f"{score:.4f}",
                        "excerpt": tail_ex,
                    }
                )
            break

    notes_ask_profile_emit(
        "rag_retrieve_format_meta_ms",
        (time.perf_counter() - _t_fmt) * 1000.0,
        parts_n=len(parts),
    )
    notes_ask_profile_emit("rag_retrieve_total_ms", (time.perf_counter() - _t_total) * 1000.0)

    return "\n\n".join(parts).strip(), meta_out, obs


def build_summaries_section(
    *,
    ordered_ids: list[str],
    user_ref: str | None,
    max_chars: int,
    project_owner_user_uuid: str | None = None,
    preloaded_by_id: dict[str, dict[str, Any]] | None = None,
) -> str:
    parts: list[str] = []
    used = 0
    for i, nid in enumerate(ordered_ids, start=1):
        row = None
        if preloaded_by_id is not None:
            row = preloaded_by_id.get(nid)
        if row is None:
            row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if not row:
            continue
        title = _metadata_title(row, nid)
        s = str(row.get("note_summary") or "").strip()
        if not s:
            continue
        block = f"### 摘要 [{i}] {title}\n\n{s}"
        if used + len(block) + 4 > max_chars:
            break
        parts.append(block)
        used += len(block) + 4
    if not parts:
        return ""
    return (
        "## 异步摘要（机器生成，仅供参考；事实与细节以原文摘录为准）\n\n"
        + "\n\n---\n\n".join(parts)
    )


def build_layered_notes_context(
    *,
    notebook: str,
    note_ids: list[str],
    query: str,
    user_ref: str | None,
    summary_budget: int,
    retrieval_budget: int,
    top_k: int = 36,
    project_owner_user_uuid: str | None = None,
) -> tuple[str | None, list[dict[str, str]], dict[str, Any]]:
    """
    若勾选范围内无任何索引块，返回 (None, [], meta) 表示应回退旧逻辑。
    否则返回 (context, sources, meta)。

    检索侧默认启用 `NOTES_ASK_RETRIEVAL_FAST=1`（见 `retrieve_chunks_across_notes` 的 notes_ask_fast_path）：
    单查询嵌入、较小 rerank 池、仅 hybrid 重排以缩短总耗时；设为 0/false/no 则与脚本参考等路径一致走完整重排。
    """
    meta: dict[str, Any] = {"layered": True, "chunks_indexed": 0}
    _t_layer = time.perf_counter()
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
    preloaded_by_id: dict[str, dict[str, Any]] = {}
    for i, nid in enumerate(ordered, start=1):
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        if not row:
            raise ValueError("note_not_found")
        if _metadata_notebook(row) != nb:
            raise ValueError("note_notebook_mismatch")
        title = _metadata_title(row, nid)
        sources.append({"index": str(i), "noteId": nid, "title": title})
        preloaded_by_id[nid] = row

    notes_ask_profile_emit(
        "layered_load_sources_ms",
        (time.perf_counter() - _t_layer) * 1000.0,
        notes_n=len(ordered),
    )
    _t_count = time.perf_counter()
    n_chunks = count_rag_chunks_for_notes(ordered)
    meta["chunks_indexed"] = n_chunks
    notes_ask_profile_emit(
        "layered_count_chunks_ms",
        (time.perf_counter() - _t_count) * 1000.0,
        chunks_indexed=n_chunks,
    )
    if n_chunks == 0:
        notes_ask_profile_emit(
            "layered_context_total_ms",
            (time.perf_counter() - _t_layer) * 1000.0,
            branch="no_chunks_fallback",
        )
        return None, [], meta

    _t_sum = time.perf_counter()
    sum_part = build_summaries_section(
        ordered_ids=ordered,
        user_ref=user_ref,
        max_chars=summary_budget,
        project_owner_user_uuid=project_owner_user_uuid,
        preloaded_by_id=preloaded_by_id,
    )
    notes_ask_profile_emit(
        "layered_summaries_ms",
        (time.perf_counter() - _t_sum) * 1000.0,
        summary_chars=len(sum_part),
    )
    _t_retr = time.perf_counter()
    _ask_fast = (os.getenv("NOTES_ASK_RETRIEVAL_FAST", "1") or "").strip().lower() not in ("0", "false", "no")
    retr, retr_meta, retrieve_obs = retrieve_chunks_across_notes(
        note_ids=ordered,
        query=query,
        max_chars=retrieval_budget,
        top_k=top_k,
        notes_ask_fast_path=_ask_fast,
    )
    notes_ask_profile_emit(
        "layered_retrieve_ms",
        (time.perf_counter() - _t_retr) * 1000.0,
        retrieval_chunks=len(retr_meta),
    )
    meta["retrieval_chunks"] = len(retr_meta)
    meta["retrieve_obs"] = retrieve_obs
    meta["retrieval_chunks_meta"] = retr_meta

    blocks: list[str] = []
    if sum_part:
        blocks.append(sum_part)
    if retr:
        blocks.append("## 与问题相关的原文摘录（向量检索，勾选范围内）\n\n" + retr)

    ctx = "\n\n---\n\n".join(blocks).strip()
    if not ctx:
        notes_ask_profile_emit(
            "layered_context_total_ms",
            (time.perf_counter() - _t_layer) * 1000.0,
            branch="empty_ctx",
        )
        return None, [], meta

    notes_ask_profile_emit(
        "layered_context_total_ms",
        (time.perf_counter() - _t_layer) * 1000.0,
        chunks_indexed=n_chunks,
        context_chars=len(ctx),
    )
    return ctx, sources, meta


def _layered_source_manifest_block(
    ordered: list[str], user_ref: str | None, project_owner_user_uuid: str | None = None
) -> str:
    """固定 N 与「来源1…N」对应关系，减少模型把检索中出现次数误当成勾选条数。"""
    n = len(ordered)
    lines: list[str] = [
        f"【来源清单】用户勾选笔记共 **{n}** 条；摘录中的「资料第 k 条」对应下方第 k 条标题。",
        f"正文若出现「综合 N 条资料」「基于 N 本书」等表述，**N 必须等于 {n}**；"
        "检索可能未在片段中均匀展示每一条，不得以「只看到 9 个来源」等理由改写为 N−1。",
        "条目：",
    ]
    for i, nid in enumerate(ordered, start=1):
        row = get_note_by_id(nid, user_ref=user_ref, project_owner_user_uuid=project_owner_user_uuid)
        title = _metadata_title(row, nid) if row else nid
        lines.append(f"- 第 {i} 条：{title}")
    return "\n".join(lines)


def build_layered_reference_block(
    *,
    note_ids: list[str],
    query_hint: str,
    user_ref: str | None,
    summary_budget: int,
    retrieval_budget: int,
    top_k: int = 40,
    project_owner_user_uuid: str | None = None,
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
        ordered_ids=ordered,
        user_ref=user_ref,
        max_chars=summary_budget,
        project_owner_user_uuid=project_owner_user_uuid,
    )
    retr, _rm, retrieve_obs = retrieve_chunks_across_notes(
        note_ids=ordered,
        query=query_hint,
        max_chars=retrieval_budget,
        top_k=top_k,
    )
    meta["retrieve_obs"] = retrieve_obs
    blocks: list[str] = [_layered_source_manifest_block(ordered, user_ref, project_owner_user_uuid)]
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
