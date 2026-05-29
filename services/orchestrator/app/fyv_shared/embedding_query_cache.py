"""查询向量 Redis 缓存（同问复用）。"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from typing import Any

from .embedding_scenarios import embedding_output_type
from .embedding_types import DocumentEmbeddings, EmbeddingScenario
from .embedding_sparse import normalize_sparse_items

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "rag_emb:query:v1"


def _cache_enabled() -> bool:
    return (os.getenv("RAG_EMBEDDING_QUERY_CACHE", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def _cache_ttl_sec() -> int:
    try:
        return max(60, min(86_400, int(os.getenv("RAG_EMBEDDING_QUERY_CACHE_TTL_SEC", "7200") or "7200")))
    except (TypeError, ValueError):
        return 7200


def _normalize_query_text(text: str) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip().lower())
    return t[:8000]


def query_cache_key(
    text: str,
    *,
    scenario: EmbeddingScenario | str,
    env_fingerprint: str,
    dim: int,
) -> str:
    norm = _normalize_query_text(text)
    digest = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:32]
    scen = (scenario or "default").strip().lower()
    out_t = embedding_output_type()
    return f"{_CACHE_PREFIX}:{env_fingerprint}:{dim}:{out_t}:{scen}:{digest}"


def get_cached_query_embeddings(
    texts: list[str],
    *,
    scenario: EmbeddingScenario | str,
    env_fingerprint: str,
    dim: int,
) -> list[DocumentEmbeddings | None]:
    if not _cache_enabled():
        return [None] * len(texts)
    try:
        from app.queue import redis_conn
    except Exception:
        return [None] * len(texts)

    keys = [query_cache_key(t, scenario=scenario, env_fingerprint=env_fingerprint, dim=dim) for t in texts]
    out: list[DocumentEmbeddings | None] = [None] * len(texts)
    try:
        raw_vals = redis_conn.mget(keys)
    except Exception as exc:
        logger.debug("query embedding cache mget failed: %s", exc)
        return out
    for i, raw in enumerate(raw_vals):
        if not raw:
            continue
        try:
            payload = json.loads(raw)
            dense = payload.get("dense")
            if not isinstance(dense, list) or not dense:
                continue
            sparse = normalize_sparse_items(payload.get("sparse"))
            out[i] = DocumentEmbeddings(dense=[float(x) for x in dense], sparse=sparse)
        except Exception:
            continue
    return out


def set_cached_query_embeddings(
    texts: list[str],
    vectors: list[DocumentEmbeddings],
    *,
    scenario: EmbeddingScenario | str,
    env_fingerprint: str,
    dim: int,
) -> None:
    if not _cache_enabled() or not texts:
        return
    try:
        from app.queue import redis_conn
    except Exception:
        return
    ttl = _cache_ttl_sec()
    pipe = redis_conn.pipeline()
    for text, vec in zip(texts, vectors):
        if not vec.dense:
            continue
        key = query_cache_key(text, scenario=scenario, env_fingerprint=env_fingerprint, dim=dim)
        payload: dict[str, Any] = {"dense": vec.dense}
        if vec.sparse:
            payload["sparse"] = vec.sparse
        try:
            pipe.setex(key, ttl, json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
        except Exception:
            continue
    try:
        pipe.execute()
    except Exception as exc:
        logger.debug("query embedding cache set failed: %s", exc)
