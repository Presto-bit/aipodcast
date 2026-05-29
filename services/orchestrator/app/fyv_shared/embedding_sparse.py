"""稀疏向量解析与打分。"""
from __future__ import annotations

from typing import Any


def normalize_sparse_items(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        idx = item.get("index", item.get("i"))
        val = item.get("value", item.get("v"))
        if idx is None or val is None:
            continue
        try:
            out.append({"index": int(idx), "value": float(val)})
        except (TypeError, ValueError):
            continue
    return out


def sparse_from_chunk_meta(meta: Any) -> list[dict[str, Any]]:
    if not isinstance(meta, dict):
        return []
    return normalize_sparse_items(meta.get("sparse_embedding"))


def sparse_dot(query_sparse: list[dict[str, Any]], doc_sparse: list[dict[str, Any]]) -> float:
    if not query_sparse or not doc_sparse:
        return 0.0
    q_map: dict[int, float] = {}
    for item in query_sparse:
        try:
            q_map[int(item["index"])] = float(item["value"])
        except (KeyError, TypeError, ValueError):
            continue
    score = 0.0
    for item in doc_sparse:
        try:
            idx = int(item["index"])
            val = float(item["value"])
        except (KeyError, TypeError, ValueError):
            continue
        score += q_map.get(idx, 0.0) * val
    return score


def batch_sparse_vs_query(
    query_sparse: list[dict[str, Any]],
    doc_sparses: list[list[dict[str, Any]]],
) -> list[float]:
    return [sparse_dot(query_sparse, d) for d in doc_sparses]
