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
) -> tuple[str, str | None]:
    """
    混合向量 RAG：对合并正文切块，关键词 + embedding 余弦混合打分，按分取块直至 rag_max_chars。
    向量由 EmbeddingProvider 提供（RAG_EMBEDDING_* / 本地 / hash），不依赖 MINIMAX_API_KEY。
    """
    rag_cap = _payload_rag_cap(payload)
    chunks = split_text_into_chunks(merged_content)
    if not chunks:
        return merged_content[:rag_cap], "no_chunks_after_split"

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
    try:
        from app.fyv_shared.embedding_provider import EmbeddingProvider

        ep = EmbeddingProvider()
        if ep.active_backend() == "hash":
            logger.warning("hybrid RAG: embedding backend=hash，检索质量可能较差，建议配置 RAG_EMBEDDING_* 或本地模型")
        # 单批限制避免超大文档爆内存
        batch_size = 32
        qv = ep.embed_texts([query[:8000]])[0]
        vec_raw = []
        for i in range(0, len(chunks), batch_size):
            batch = [c[:8000] for c in chunks[i : i + batch_size]]
            vecs = ep.embed_texts(batch)
            for v in vecs:
                vec_raw.append(_cosine(qv, v))
        emb_log = f"emb_backend={ep.active_backend()}"
    except Exception as exc:
        logger.warning("hybrid embedding failed, keyword-only: %s", exc)
        emb_log = f"emb_error={exc!s}"[:300]
        vec_raw = [0.0] * len(chunks)

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
        f"out_chars={len(out)} rag_cap={rag_cap}"
    )
    return out, log_msg
