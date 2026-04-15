"""
检索结果重排：默认 hybrid（向量分 + 关键词分），可选 Cohere rerank API。
密钥通过环境变量配置，不在代码中硬编码。
"""
from __future__ import annotations

import logging
import os
from typing import Any

import requests

from app.rag_core import _keyword_score, _norm_minmax

logger = logging.getLogger(__name__)


def _cohere_api_key() -> str:
    return (os.getenv("RAG_COHERE_API_KEY") or os.getenv("COHERE_API_KEY") or "").strip()


def _rerank_enabled() -> bool:
    return (os.getenv("NOTE_RAG_RERANK", "1") or "").strip().lower() not in ("0", "false", "no")


def _rerank_provider_name() -> str:
    return (os.getenv("RAG_RERANK_PROVIDER") or "hybrid").strip().lower()


def _hybrid_weights() -> tuple[float, float]:
    try:
        w_v = float(os.getenv("RAG_RERANK_VECTOR_WEIGHT", "0.65"))
        w_k = float(os.getenv("RAG_RERANK_KEYWORD_WEIGHT", "0.35"))
    except (TypeError, ValueError):
        return 0.65, 0.35
    s = w_v + w_k
    if s <= 0:
        return 0.65, 0.35
    return w_v / s, w_k / s


def hybrid_lexical_rerank(
    query: str,
    scored: list[tuple[float, dict[str, Any]]],
    *,
    w_v: float,
    w_k: float,
) -> list[tuple[float, dict[str, Any]]]:
    """对 (向量相似度, row) 列表按「归一化向量分 + 归一化关键词分」混合重排，首元更新为混合分。"""
    if not scored:
        return []
    q = (query or "").strip()
    vec_scores = [float(t[0]) for t in scored]
    kws: list[float] = []
    for _, row in scored:
        ch = str(row.get("chunk_text") or "")
        kws.append(float(_keyword_score(q, ch)) if q else 0.0)
    nv = _norm_minmax(vec_scores)
    nk = _norm_minmax(kws)
    combined = [w_v * nv[i] + w_k * nk[i] for i in range(len(scored))]
    order = sorted(range(len(scored)), key=lambda i: -combined[i])
    out: list[tuple[float, dict[str, Any]]] = []
    for i in order:
        out.append((float(combined[i]), scored[i][1]))
    return out


def _cohere_rerank(
    query: str,
    scored: list[tuple[float, dict[str, Any]]],
    *,
    api_key: str,
) -> list[tuple[float, dict[str, Any]]] | None:
    if not scored:
        return []
    docs = [str(t[1].get("chunk_text") or "")[:12000] for t in scored]
    top_n = len(docs)
    try:
        resp = requests.post(
            "https://api.cohere.ai/v1/rerank",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": (os.getenv("RAG_COHERE_RERANK_MODEL") or "rerank-multilingual-v3.0").strip(),
                "query": (query or "")[:8000],
                "documents": docs,
                "top_n": top_n,
            },
            timeout=45,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results")
        if not isinstance(results, list) or not results:
            return None
        out: list[tuple[float, dict[str, Any]]] = []
        for item in results:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            if not isinstance(idx, int) or idx < 0 or idx >= len(scored):
                continue
            rel = item.get("relevance_score")
            try:
                score = float(rel) if rel is not None else float(scored[idx][0])
            except (TypeError, ValueError):
                score = float(scored[idx][0])
            out.append((score, scored[idx][1]))
        return out if len(out) == len(scored) else None
    except Exception as exc:
        logger.warning("Cohere rerank failed: %s", exc)
        return None


def rerank_retrieval_candidates(
    query: str,
    scored: list[tuple[float, dict[str, Any]]],
) -> tuple[list[tuple[float, dict[str, Any]]], str]:
    """
    对一批已按向量分排序的候选重排；返回 (新列表, 模式标签)。
    """
    if not _rerank_enabled() or not scored:
        return scored, "off"

    prov = _rerank_provider_name()
    w_v, w_k = _hybrid_weights()

    if prov == "cohere":
        key = _cohere_api_key()
        if key:
            coh = _cohere_rerank(query, scored, api_key=key)
            if coh is not None:
                return coh, "cohere"
            logger.info("Cohere rerank unavailable, fallback hybrid")
        else:
            logger.debug("RAG_RERANK_PROVIDER=cohere but no RAG_COHERE_API_KEY/COHERE_API_KEY, using hybrid")

    return hybrid_lexical_rerank(query, scored, w_v=w_v, w_k=w_k), "hybrid"
