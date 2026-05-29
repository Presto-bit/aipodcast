"""分场景 query instruct 与检索配置。"""
from __future__ import annotations

import os

from .embedding_types import DEFAULT_SCENARIO, EmbeddingScenario

_DEFAULT_NOTES_ASK = (
    "Given a user question about their personal knowledge base and notes, "
    "retrieve the most relevant note passages for answering."
)
_DEFAULT_PODCAST_REFERENCE = (
    "Given a podcast script writing task, retrieve source note passages "
    "that support accurate facts, quotes, and narrative structure."
)


def query_instruct_enabled() -> bool:
    return (os.getenv("RAG_EMBEDDING_QUERY_INSTRUCT_ENABLED", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def query_instruct_for_scenario(scenario: EmbeddingScenario | str | None) -> str | None:
    if not query_instruct_enabled():
        return None
    key = (scenario or DEFAULT_SCENARIO).strip().lower()
    if key == "notes_ask":
        raw = (os.getenv("RAG_EMBEDDING_INSTRUCT_NOTES_ASK") or _DEFAULT_NOTES_ASK).strip()
    elif key == "podcast_reference":
        raw = (
            os.getenv("RAG_EMBEDDING_INSTRUCT_PODCAST_REFERENCE") or _DEFAULT_PODCAST_REFERENCE
        ).strip()
    else:
        raw = (os.getenv("RAG_EMBEDDING_QUERY_INSTRUCT") or _DEFAULT_NOTES_ASK).strip()
    return raw or None


def embedding_output_type() -> str:
    raw = (os.getenv("RAG_EMBEDDING_OUTPUT_TYPE") or "dense").strip().lower()
    if raw in ("dense&sparse", "dense_sparse", "hybrid"):
        return "dense&sparse"
    return "dense"


def sparse_scoring_enabled() -> bool:
    if embedding_output_type() != "dense&sparse":
        return False
    return (os.getenv("RAG_EMBEDDING_SPARSE_SCORING", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def sparse_score_weight() -> float:
    try:
        return max(0.0, min(0.6, float(os.getenv("RAG_EMBEDDING_SPARSE_WEIGHT", "0.18") or "0.18")))
    except (TypeError, ValueError):
        return 0.18
