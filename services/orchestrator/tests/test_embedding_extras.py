from __future__ import annotations

import json

import pytest

from app.fyv_shared.embedding_scenarios import query_instruct_for_scenario
from app.fyv_shared.embedding_sparse import batch_sparse_vs_query, sparse_dot, sparse_from_chunk_meta
from app.fyv_shared.embedding_types import DocumentEmbeddings


def test_query_instruct_by_scenario(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_QUERY_INSTRUCT_ENABLED", "1")
    monkeypatch.setenv("RAG_EMBEDDING_INSTRUCT_NOTES_ASK", "notes ask instruct")
    monkeypatch.setenv("RAG_EMBEDDING_INSTRUCT_PODCAST_REFERENCE", "podcast instruct")
    assert query_instruct_for_scenario("notes_ask") == "notes ask instruct"
    assert query_instruct_for_scenario("podcast_reference") == "podcast instruct"


def test_sparse_dot_and_meta_compact() -> None:
    q = [{"index": 1, "value": 2.0}, {"index": 3, "value": 1.0}]
    d = [{"index": 1, "value": 0.5}, {"index": 2, "value": 4.0}]
    assert sparse_dot(q, d) == 1.0
    meta = {"sparse_embedding": [{"i": 9, "v": 0.25}]}
    assert sparse_from_chunk_meta(meta) == [{"index": 9, "value": 0.25}]
    doc = DocumentEmbeddings(dense=[0.1], sparse=q)
    patch = doc.sparse_patch_for_meta()
    assert patch["sparse_embedding"] == [{"i": 1, "v": 2.0}, {"i": 3, "v": 1.0}]


def test_batch_sparse_vs_query() -> None:
    q = [{"index": 5, "value": 2.0}]
    docs = [[{"index": 5, "value": 1.0}], [{"index": 6, "value": 3.0}]]
    scores = batch_sparse_vs_query(q, docs)
    assert scores == [2.0, 0.0]
