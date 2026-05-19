"""
编排器内置参考材料 RAG（新架构，不依赖已移除的 backend/rag_utils）。

- truncate：头中尾截断（在 reference_material.compress_long_reference）
- keyword：分块 + 关键词打分检索 Top-K
- full_coverage：按相关性优先拼接多块，直至字数上限
- hybrid：关键词分数 + EmbeddingProvider（OpenAI 兼容 / MiniMax / 本地 / hash）余弦相似度加权混合

向量库为「单次任务、内存内」索引：对当次合并后的长文切块并即时 embedding，不依赖历史持久化库。
可选环境变量：RAG_HYBRID_VECTOR_WEIGHT / RAG_HYBRID_KEYWORD_WEIGHT（默认 0.55 / 0.45）、
RAG_CHUNK_CHARS、RAG_CHUNK_OVERLAP（见代码内默认值）。
"""
from __future__ import annotations

import logging
import math
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

# 与 reference_material.RAG_HYBRID_TRIGGER_CHARS 语义一致时可略小于块和，此处仅用于切块参数
_DEFAULT_CHUNK = 1100
_DEFAULT_OVERLAP = 90


def _split_plain_paragraphs(raw: str, mc: int, ov: int) -> list[str]:
    """按空行分段，再按长度切分，带少量重叠避免句断在边界。"""
    paragraphs = re.split(r"\n\s*\n+", raw.strip())
    pieces: list[str] = []
    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if len(p) <= mc:
            pieces.append(p)
            continue
        start = 0
        while start < len(p):
            end = min(len(p), start + mc)
            chunk = p[start:end].strip()
            if chunk:
                pieces.append(chunk)
            if end >= len(p):
                break
            start = max(0, end - ov)
    return pieces


def split_text_into_chunks(
    text: str,
    *,
    max_chunk_chars: int | None = None,
    overlap: int | None = None,
) -> list[str]:
    """优先在 Markdown 行首标题处切段，再按空行与长度切分，带少量重叠。"""
    raw = (text or "").strip()
    if not raw:
        return []
    mc = max(400, int(max_chunk_chars or int(os.getenv("RAG_CHUNK_CHARS", str(_DEFAULT_CHUNK)))))
    ov = max(0, min(mc // 4, int(overlap or int(os.getenv("RAG_CHUNK_OVERLAP", str(_DEFAULT_OVERLAP))))))

    if re.search(r"(?m)^#{1,6}\s+\S", raw):
        sections = [s.strip() for s in re.split(r"(?m)(?=^#{1,6}\s+\S)", raw) if s.strip()]
        if len(sections) > 1:
            pieces: list[str] = []
            for sec in sections:
                pieces.extend(_split_plain_paragraphs(sec, mc, ov))
            return pieces
    return _split_plain_paragraphs(raw, mc, ov)


def _is_table_block(meta: dict[str, Any], text: str) -> bool:
    bt = str(meta.get("block_type") or "").lower()
    if bt in ("table", "table_row"):
        return True
    t = (text or "").strip()
    return t.startswith("|") and "|" in t[1:]


def _is_list_block(meta: dict[str, Any], text: str) -> bool:
    bt = str(meta.get("block_type") or "").lower()
    if bt in ("list", "list_item"):
        return True
    return bool(re.match(r"^(\- |\* |\d+\.\s+)", (text or "").strip()))


def _split_table_text(text: str, *, max_chunk_chars: int) -> list[str]:
    """表格按行切分，避免在行中间截断。"""
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return []
    if sum(len(ln) + 1 for ln in lines) <= max_chunk_chars * 2:
        return ["\n".join(lines)]
    pieces: list[str] = []
    batch: list[str] = []
    used = 0
    for ln in lines:
        extra = len(ln) + (1 if batch else 0)
        if batch and used + extra > max_chunk_chars:
            pieces.append("\n".join(batch))
            batch = [ln]
            used = len(ln)
        else:
            batch.append(ln)
            used += extra
    if batch:
        pieces.append("\n".join(batch))
    return pieces


def split_segments_into_chunks_with_meta(
    segments: list[dict[str, Any]],
    *,
    max_chunk_chars: int | None = None,
    overlap: int | None = None,
) -> list[tuple[str, dict[str, Any]]]:
    """
    将结构化分段再切成向量块；表格尽量整表/按行、列表按项合并，继承 meta。
    """
    out: list[tuple[str, dict[str, Any]]] = []
    if not segments:
        return out
    mc = max(400, int(max_chunk_chars or int(os.getenv("RAG_CHUNK_CHARS", str(_DEFAULT_CHUNK)))))
    ov = max(0, min(mc // 4, int(overlap or int(os.getenv("RAG_CHUNK_OVERLAP", str(_DEFAULT_OVERLAP))))))

    i = 0
    while i < len(segments):
        seg = segments[i]
        if not isinstance(seg, dict):
            i += 1
            continue
        text = str(seg.get("text") or "").strip()
        raw_meta = seg.get("meta")
        meta: dict[str, Any] = dict(raw_meta) if isinstance(raw_meta, dict) else {}
        if not text:
            i += 1
            continue

        if _is_table_block(meta, text):
            table_id = str(meta.get("table_id") or f"t{i}")
            j = i + 1
            merged_lines = [text]
            while j < len(segments):
                nxt = segments[j]
                if not isinstance(nxt, dict):
                    break
                nt = str(nxt.get("text") or "").strip()
                nm = nxt.get("meta") if isinstance(nxt.get("meta"), dict) else {}
                if not _is_table_block(nm, nt):
                    break
                merged_lines.append(nt)
                j += 1
            blob = "\n".join(merged_lines)
            for piece in _split_table_text(blob, max_chunk_chars=mc):
                pt = piece.strip()
                if pt:
                    m = {**meta, "block_type": "table", "table_id": table_id}
                    out.append((pt, m))
            i = j
            continue

        if _is_list_block(meta, text):
            items: list[str] = [text]
            j = i + 1
            while j < len(segments):
                nxt = segments[j]
                if not isinstance(nxt, dict):
                    break
                nt = str(nxt.get("text") or "").strip()
                nm = nxt.get("meta") if isinstance(nxt.get("meta"), dict) else {}
                if not _is_list_block(nm, nt):
                    break
                items.append(nt)
                j += 1
            blob = "\n".join(items)
            if len(blob) <= mc:
                out.append((blob, {**meta, "block_type": "list"}))
            else:
                for piece in split_text_into_chunks(blob, max_chunk_chars=mc, overlap=ov):
                    pt = (piece or "").strip()
                    if pt:
                        out.append((pt, {**meta, "block_type": "list"}))
            i = j
            continue

        for piece in split_text_into_chunks(text, max_chunk_chars=mc, overlap=ov):
            pt = (piece or "").strip()
            if pt:
                out.append((pt, meta))
        i += 1
    return out


def decompose_retrieval_queries(text: str, *, max_queries: int = 3) -> list[str]:
    """
    将主题/检索句拆成若干子查询，用于多向量 max-pool（跨句命中不同文档）。
    无有效拆分时返回单条全文前缀。
    """
    raw = (text or "").strip()
    if not raw:
        return [""]
    main = raw[:8000]
    try:
        mq = max(1, min(5, int(max_queries)))
    except (TypeError, ValueError):
        mq = 3

    min_seg = 8
    segments: list[str] = []
    for block in re.split(r"(?<=[。！？\n])\s*", raw):
        s = (block or "").strip()
        if len(s) >= min_seg:
            segments.append(s[:8000])

    if len(segments) < 2:
        for block in re.split(r"\n\s*\n+", raw):
            s = (block or "").strip()
            if len(s) >= min_seg:
                segments.append(s[:8000])

    out: list[str] = [main]
    if mq <= 1 or len(segments) < 2:
        return out

    seen: set[str] = {main}
    for s in segments:
        if s in seen or len(s) < min_seg:
            continue
        seen.add(s)
        out.append(s[:8000])
        if len(out) >= mq:
            break
    return out[: max(1, len(out))]


def build_retrieval_query(
    topic_hint: str,
    script_style: str,
    script_language: str,
    program_name: str,
    speaker1_persona: str,
    speaker2_persona: str,
    script_constraints: str,
) -> str:
    parts = [
        topic_hint,
        script_style,
        script_language,
        program_name,
        speaker1_persona,
        speaker2_persona,
        script_constraints,
    ]
    q = " ".join(str(p).strip() for p in parts if str(p).strip())
    return q[:8000] if q else ""


def _tokenize(text: str) -> list[str]:
    t = (text or "").lower()
    # 英文词 + 连续 CJK 字（2 字及以上子串过多会爆，用字 unigram + bigram 折中）
    words = re.findall(r"[a-z0-9_]{2,}", t)
    chars = re.findall(r"[\u4e00-\u9fff]", t)
    bigrams: list[str] = []
    for i in range(len(chars) - 1):
        bigrams.append(chars[i] + chars[i + 1])
    return words + bigrams + chars


def _keyword_score(query: str, chunk: str) -> float:
    q_toks = set(_tokenize(query))
    if not q_toks:
        return 0.0
    c_toks = _tokenize(chunk)
    if not c_toks:
        return 0.0
    c_set = set(c_toks)
    inter = len(q_toks & c_set)
    return float(inter) / (1.0 + math.log(2.0 + len(c_set)))


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    s = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na <= 0 or nb <= 0:
        return 0.0
    return s / (na * nb)


def _norm_minmax(vals: list[float]) -> list[float]:
    if not vals:
        return []
    lo, hi = min(vals), max(vals)
    if hi <= lo + 1e-12:
        return [0.5 for _ in vals]
    return [(v - lo) / (hi - lo) for v in vals]


def retrieve_top_chunks(
    document: str,
    query: str,
    *,
    top_k: int = 8,
    max_chunk_chars: int | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """
    返回 (top_chunks 列表, 文档总块数)。
    每项含 chunk_index, score, content。
    """
    chunks = split_text_into_chunks(document, max_chunk_chars=max_chunk_chars)
    n = len(chunks)
    if not chunks or not (query or "").strip():
        return [], n

    scored: list[dict[str, Any]] = []
    for i, ch in enumerate(chunks):
        s = _keyword_score(query, ch)
        scored.append({"chunk_index": i, "score": float(s), "content": ch})
    scored.sort(key=lambda x: -float(x["score"]))
    k = max(1, min(top_k, len(scored)))
    return scored[:k], n


def build_full_coverage_context(
    document: str,
    query: str,
    *,
    max_total_chars: int,
    max_chunk_chars: int | None = None,
) -> tuple[str, int]:
    """
    在字数上限内尽量覆盖：按关键词相关度排序块后贪心拼接；过长单块再截断。
    """
    chunks = split_text_into_chunks(document, max_chunk_chars=max_chunk_chars)
    n = len(chunks)
    if not chunks:
        return "", 0

    q = (query or "").strip()
    indexed = [(i, _keyword_score(q, ch) if q else 0.0, ch) for i, ch in enumerate(chunks)]
    indexed.sort(key=lambda x: -x[1])

    budget = min(max(500, int(max_total_chars)), 120_000)
    out_parts: list[str] = []
    used = 0
    for i, _sc, ch in indexed:
        header = f"【全文覆盖块 {i}】\n"
        need = len(header) + len(ch)
        if used + need <= budget:
            out_parts.append(header + ch)
            used += need
        else:
            remain = budget - used - len(header) - 24
            if remain > 400:
                out_parts.append(header + ch[:remain] + "\n【…块内截断…】")
            break

    text = "\n\n".join(out_parts).strip()
    if len(text) > budget:
        text = text[:budget] + "\n【…截断…】"
    return text, n


def _payload_rag_cap(payload: dict[str, Any]) -> int:
    raw = payload.get("rag_max_chars")
    try:
        rag_cap = int(raw) if raw is not None else 28_000
    except (TypeError, ValueError):
        rag_cap = 28_000
    return max(8_000, min(120_000, rag_cap))


def apply_hybrid_vector_rag(
    merged_content: str,
    payload: dict[str, Any],
    api_key: str | None,
) -> tuple[str, str | None, int]:
    """
    混合向量 RAG：对合并正文切块，关键词 + embedding 余弦混合打分，按分取块直至 rag_max_chars。
    向量由 EmbeddingProvider 提供（RAG_EMBEDDING_* / 本地 / hash），不依赖 MINIMAX_API_KEY。
    返回 (压缩后正文, 日志, embedding 输入字符数，供成本看板)。
    """
    rag_cap = _payload_rag_cap(payload)
    chunks = split_text_into_chunks(merged_content)
    if not chunks:
        return merged_content[:rag_cap], "no_chunks_after_split", 0

    topic_text = str(payload.get("text") or merged_content[:2000])[:2000]
    query = build_retrieval_query(
        topic_text,
        str(payload.get("script_style") or ""),
        str(payload.get("script_language") or "中文"),
        str(payload.get("program_name") or ""),
        str(payload.get("speaker1_persona") or ""),
        str(payload.get("speaker2_persona") or ""),
        str(payload.get("script_constraints") or ""),
    )
    if not query.strip():
        query = topic_text[:1200]

    kw_raw = [_keyword_score(query, c) for c in chunks]

    vec_raw: list[float] | None = None
    emb_log = ""
    emb_input_chars = 0
    emb_backend = "hash"
    try:
        from app.fyv_shared.embedding_provider import EmbeddingProvider

        ep = EmbeddingProvider()
        emb_backend = ep.active_backend()
        if emb_backend == "hash":
            logger.warning("hybrid RAG: embedding backend=hash，检索质量可能较差，建议配置 RAG_EMBEDDING_* 或本地模型")
        # 单批限制避免超大文档爆内存
        batch_size = 32
        q_slice = query[:8000]
        qv = ep.embed_texts([q_slice])[0]
        if emb_backend == "api":
            emb_input_chars += len(q_slice)
        vec_raw = []
        for i in range(0, len(chunks), batch_size):
            batch = [c[:8000] for c in chunks[i : i + batch_size]]
            vecs = ep.embed_texts(batch)
            if emb_backend == "api":
                emb_input_chars += sum(len(b) for b in batch)
            for v in vecs:
                vec_raw.append(_cosine(qv, v))
        emb_log = f"emb_backend={emb_backend}"
    except Exception as exc:
        logger.warning("hybrid embedding failed, keyword-only: %s", exc)
        emb_log = f"emb_error={exc!s}"[:300]
        vec_raw = [0.0] * len(chunks)
        emb_input_chars = 0

    w_v = float(os.getenv("RAG_HYBRID_VECTOR_WEIGHT", "0.55"))
    w_k = float(os.getenv("RAG_HYBRID_KEYWORD_WEIGHT", "0.45"))
    s = w_k + w_v
    if s > 0:
        w_k, w_v = w_k / s, w_v / s

    nk = _norm_minmax(kw_raw)
    nv = _norm_minmax(vec_raw) if vec_raw is not None else [0.0] * len(chunks)
    combined = [w_k * nk[i] + w_v * nv[i] for i in range(len(chunks))]

    order = sorted(range(len(chunks)), key=lambda i: -combined[i])

    parts: list[str] = []
    total = 0
    for idx in order:
        block = chunks[idx]
        header = f"【混合检索片段 {idx} | score={combined[idx]:.4f}】\n"
        piece = header + block
        if total + len(piece) <= rag_cap:
            parts.append(piece)
            total += len(piece) + 2
            continue
        remain = rag_cap - total - len(header) - 32
        if remain > 280:
            parts.append(header + block[:remain] + "\n【…块内截断…】")
        break

    out = "\n\n".join(parts).strip()
    if len(out) > rag_cap:
        out = out[:rag_cap] + "\n【…截断…】"

    log_msg = (
        f"chunks={len(chunks)} {emb_log} w_k={w_k:.2f} w_v={w_v:.2f} "
        f"out_chars={len(out)} rag_cap={rag_cap} emb_in_chars={emb_input_chars}"
    )
    return out, log_msg, int(emb_input_chars)


def note_rag_index_strategy() -> str:
    s = (os.getenv("NOTE_RAG_INDEX_STRATEGY", "per_shard") or "per_shard").strip().lower()
    if s in ("head", "head_tail", "per_chapter", "per_shard"):
        return s
    return "per_shard"


def _per_shard_min_chunks() -> int:
    try:
        return max(1, min(32, int(os.getenv("NOTE_RAG_PER_SHARD_MIN_CHUNKS", "8") or "8")))
    except (TypeError, ValueError):
        return 8


def _per_chapter_min_chunks() -> int:
    try:
        return max(1, min(16, int(os.getenv("NOTE_RAG_PER_CHAPTER_MIN_CHUNKS", "2") or "2")))
    except (TypeError, ValueError):
        return 2


def note_rag_index_tail_ratio() -> float:
    try:
        return max(0.05, min(0.45, float(os.getenv("NOTE_RAG_INDEX_TAIL_RATIO", "0.22") or "0.22")))
    except (TypeError, ValueError):
        return 0.22


def _select_chunks_per_chapter(
    chunks: list[str],
    chunk_metas: list[dict[str, Any]],
    cap: int,
) -> tuple[list[int], dict[str, Any]]:
    """每章至少若干块，再按章均匀分配剩余额度。"""
    by_ch: dict[str, list[int]] = {}
    for i, m in enumerate(chunk_metas):
        cid = str((m or {}).get("chapter_id") or "c0")
        by_ch.setdefault(cid, []).append(i)
    if not by_ch:
        return list(range(min(cap, len(chunks)))), {"chaptersInIndex": 0}

    min_per = _per_chapter_min_chunks()
    selected: list[int] = []
    seen: set[int] = set()
    chapter_ids = sorted(by_ch.keys(), key=lambda c: min(by_ch[c]) if by_ch[c] else 0)

    for cid in chapter_ids:
        for idx in by_ch[cid][:min_per]:
            if idx not in seen and len(selected) < cap:
                seen.add(idx)
                selected.append(idx)

    remaining = cap - len(selected)
    if remaining > 0:
        per_extra = max(1, remaining // max(1, len(chapter_ids)))
        for cid in chapter_ids:
            for idx in by_ch[cid]:
                if len(selected) >= cap:
                    break
                if idx in seen:
                    continue
                if sum(1 for s in selected if s in by_ch[cid]) >= min_per + per_extra:
                    continue
                seen.add(idx)
                selected.append(idx)
        for cid in chapter_ids:
            for idx in by_ch[cid]:
                if len(selected) >= cap:
                    break
                if idx not in seen:
                    seen.add(idx)
                    selected.append(idx)

    selected.sort()
    return selected, {"chaptersInIndex": len(chapter_ids)}


def _select_chunks_per_shard(
    chunks: list[str],
    chunk_metas: list[dict[str, Any]],
    cap: int,
) -> tuple[list[int], dict[str, Any]]:
    by_sid: dict[str, list[int]] = {}
    for i, m in enumerate(chunk_metas):
        sid = str((m or {}).get("shard_id") or "s0")
        by_sid.setdefault(sid, []).append(i)
    if not by_sid:
        return list(range(min(cap, len(chunks)))), {"shardsInIndex": 0}

    min_per = _per_shard_min_chunks()
    selected: list[int] = []
    seen: set[int] = set()
    shard_ids = sorted(by_sid.keys(), key=lambda s: min(by_sid[s]) if by_sid[s] else 0)

    tail_per = max(1, min_per // 2)
    for sid in shard_ids:
        indices = by_sid[sid]
        for idx in indices[:min_per]:
            if idx not in seen and len(selected) < cap:
                seen.add(idx)
                selected.append(idx)
        if len(indices) > min_per:
            for idx in indices[-tail_per:]:
                if idx not in seen and len(selected) < cap:
                    seen.add(idx)
                    selected.append(idx)

    remaining = cap - len(selected)
    if remaining > 0:
        per_extra = max(1, remaining // max(1, len(shard_ids)))
        for sid in shard_ids:
            for idx in by_sid[sid]:
                if len(selected) >= cap:
                    break
                if idx in seen:
                    continue
                if sum(1 for s in selected if s in by_sid[sid]) >= min_per + per_extra:
                    continue
                seen.add(idx)
                selected.append(idx)
        for sid in shard_ids:
            for idx in by_sid[sid]:
                if len(selected) >= cap:
                    break
                if idx not in seen:
                    seen.add(idx)
                    selected.append(idx)

    selected.sort()
    return selected, {"shardsInIndex": len(shard_ids)}


def select_chunks_for_index(
    chunks: list[str],
    chunk_metas: list[dict[str, Any]],
    abs_cap: int,
) -> tuple[list[str], list[dict[str, Any]], dict[str, Any]]:
    """按策略从全量切块中选取入库块（per_shard / per_chapter / head / head_tail）。"""
    n = len(chunks)
    cap = max(0, min(abs_cap, n))
    strategy = note_rag_index_strategy()
    total_chars = sum(len(c) for c in chunks)
    if n <= cap:
        indexed_chars = total_chars
        return (
            chunks,
            chunk_metas[:n] if chunk_metas else [{} for _ in chunks],
            {
                "ragChunksTotal": n,
                "ragChunksIndexed": n,
                "ragIndexTruncated": False,
                "ragIndexStrategy": strategy,
                "ragTotalChars": total_chars,
                "ragIndexedChars": indexed_chars,
                "ragIndexCoveragePct": 100 if total_chars else 100,
            },
        )

    if strategy == "per_shard":
        indices, sh_stats = _select_chunks_per_shard(chunks, chunk_metas, cap)
        sel_chunks = [chunks[i] for i in indices]
        sel_metas = [
            dict(chunk_metas[i]) if i < len(chunk_metas) and isinstance(chunk_metas[i], dict) else {}
            for i in indices
        ]
        indexed_chars = sum(len(c) for c in sel_chunks)
        pct = min(100, round(100.0 * indexed_chars / total_chars)) if total_chars else 100
        return (
            sel_chunks,
            sel_metas,
            {
                "ragChunksTotal": n,
                "ragChunksIndexed": len(sel_chunks),
                "ragIndexTruncated": len(sel_chunks) < n,
                "ragIndexStrategy": strategy,
                "ragTotalChars": total_chars,
                "ragIndexedChars": indexed_chars,
                "ragIndexCoveragePct": pct,
                **sh_stats,
            },
        )

    if strategy == "per_chapter":
        indices, ch_stats = _select_chunks_per_chapter(chunks, chunk_metas, cap)
        sel_chunks = [chunks[i] for i in indices]
        sel_metas = [
            dict(chunk_metas[i]) if i < len(chunk_metas) and isinstance(chunk_metas[i], dict) else {}
            for i in indices
        ]
        indexed_chars = sum(len(c) for c in sel_chunks)
        pct = min(100, round(100.0 * indexed_chars / total_chars)) if total_chars else 100
        return (
            sel_chunks,
            sel_metas,
            {
                "ragChunksTotal": n,
                "ragChunksIndexed": len(sel_chunks),
                "ragIndexTruncated": len(sel_chunks) < n,
                "ragIndexStrategy": strategy,
                "ragTotalChars": total_chars,
                "ragIndexedChars": indexed_chars,
                "ragIndexCoveragePct": pct,
                **ch_stats,
            },
        )

    if strategy == "head_tail" and cap >= 2:
        tail_n = max(1, min(cap - 1, int(round(cap * note_rag_index_tail_ratio()))))
        head_n = cap - tail_n
        indices: list[int] = []
        seen: set[int] = set()
        for i in list(range(head_n)) + list(range(n - tail_n, n)):
            if i in seen:
                continue
            seen.add(i)
            indices.append(i)
        sel_chunks = [chunks[i] for i in indices]
        sel_metas = [
            dict(chunk_metas[i]) if i < len(chunk_metas) and isinstance(chunk_metas[i], dict) else {}
            for i in indices
        ]
    else:
        sel_chunks = chunks[:cap]
        sel_metas = chunk_metas[:cap] if chunk_metas else [{} for _ in range(cap)]
        if len(sel_metas) < len(sel_chunks):
            sel_metas.extend({} for _ in range(len(sel_chunks) - len(sel_metas)))

    indexed_chars = sum(len(c) for c in sel_chunks)
    pct = min(100, round(100.0 * indexed_chars / total_chars)) if total_chars else 100
    return (
        sel_chunks,
        sel_metas,
        {
            "ragChunksTotal": n,
            "ragChunksIndexed": len(sel_chunks),
            "ragIndexTruncated": True,
            "ragIndexStrategy": strategy,
            "ragTotalChars": total_chars,
            "ragIndexedChars": indexed_chars,
            "ragIndexCoveragePct": pct,
        },
    )


def join_chunks_for_summary(chunks: list[str], *, max_chars: int | None = None) -> str:
    """拼接已入选索引块，供机器摘要。"""
    try:
        default_cap = max(8000, min(120_000, int(os.getenv("NOTE_RAG_SUMMARY_INPUT_CAP", "44000") or "44000")))
    except (TypeError, ValueError):
        default_cap = 44_000
    cap = max_chars if max_chars is not None else default_cap
    parts: list[str] = []
    used = 0
    for ch in chunks:
        piece = (ch or "").strip()
        if not piece:
            continue
        extra = len(piece) + (2 if parts else 0)
        if used + extra > cap:
            if not parts:
                parts.append(piece[:cap])
            break
        parts.append(piece)
        used += extra
    return "\n\n".join(parts)
