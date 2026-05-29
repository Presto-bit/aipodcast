from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.fyv_shared.embedding_provider import (
    EmbeddingProvider,
    _embedding_api_batch_size,
    _embedding_dimensions_from_env,
    embedding_env_fingerprint,
)


def test_embedding_dimensions_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAG_EMBEDDING_DIMENSIONS", raising=False)
    assert _embedding_dimensions_from_env() is None
    monkeypatch.setenv("RAG_EMBEDDING_DIMENSIONS", "1024")
    assert _embedding_dimensions_from_env() == 1024
    monkeypatch.setenv("RAG_EMBEDDING_DIMENSIONS", "bad")
    assert _embedding_dimensions_from_env() is None


def test_embedding_api_batch_size_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAG_EMBEDDING_API_BATCH_SIZE", raising=False)
    assert _embedding_api_batch_size("text-embedding-v4", "https://dashscope.aliyuncs.com/x") == 10
    assert _embedding_api_batch_size("embo-01", "https://api.minimax.chat/v1/embeddings") == 32


def test_embedding_api_batch_size_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_API_BATCH_SIZE", "5")
    assert _embedding_api_batch_size("text-embedding-v4", "https://dashscope.aliyuncs.com/x") == 5


def test_fingerprint_includes_dimensions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_MODEL", "text-embedding-v4")
    monkeypatch.setenv("RAG_EMBEDDING_DIMENSIONS", "1024")
    a = embedding_env_fingerprint()
    monkeypatch.setenv("RAG_EMBEDDING_DIMENSIONS", "768")
    b = embedding_env_fingerprint()
    assert a != b


def test_embed_post_batched_splits_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "api")
    monkeypatch.setenv("RAG_EMBEDDING_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings")
    monkeypatch.setenv("RAG_EMBEDDING_MODEL", "text-embedding-v4")
    monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "sk-test")
    monkeypatch.setenv("RAG_EMBEDDING_API_BATCH_SIZE", "2")
    monkeypatch.setenv("RAG_EMBEDDING_MINIMAX_FALLBACK", "0")

    ep = EmbeddingProvider()
    calls: list[int] = []

    def fake_post(url: str, api_key: str, model: str, texts: list[str]) -> list[list[float]]:
        calls.append(len(texts))
        return [[float(i)] for i in range(len(texts))]

    with patch.object(ep, "_embed_post", side_effect=fake_post):
        out = ep._embed_post_batched("https://dashscope.aliyuncs.com/x", "sk-test", "text-embedding-v4", ["a", "b", "c", "d", "e"])

    assert calls == [2, 2, 1]
    assert len(out) == 5


def test_embed_post_includes_dimensions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_DIMENSIONS", "1024")
    ep = EmbeddingProvider()
    ep.api_dimensions = 1024

    captured: list[dict] = []

    def fake_post(url: str, json: dict, headers: dict, timeout: int) -> MagicMock:
        captured.append(json)
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"data": [{"embedding": [0.1, 0.2]}]}
        return resp

    with patch("app.fyv_shared.embedding_provider.requests.post", side_effect=fake_post):
        ep._embed_post("https://dashscope.aliyuncs.com/x", "sk-test", "text-embedding-v4", ["hello"])

    assert captured
    assert any(body.get("dimensions") == 1024 for body in captured)


def test_api_key_falls_back_to_qwen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAG_EMBEDDING_API_KEY", raising=False)
    monkeypatch.setenv("QWEN_API_KEY", "sk-qwen")
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    ep = EmbeddingProvider()
    assert ep.api_key == "sk-qwen"


def test_embed_queries_uses_dashscope_native_with_instruct(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "api")
    monkeypatch.setenv("RAG_EMBEDDING_MODEL", "text-embedding-v4")
    monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "sk-test")
    monkeypatch.setenv("RAG_EMBEDDING_DIMENSIONS", "1024")
    monkeypatch.setenv("RAG_EMBEDDING_INSTRUCT_NOTES_ASK", "Given a query, retrieve notes")
    monkeypatch.setenv("RAG_EMBEDDING_MINIMAX_FALLBACK", "0")
    monkeypatch.setenv("RAG_EMBEDDING_QUERY_CACHE", "0")

    captured: list[dict] = []

    def fake_post(url: str, json: dict, headers: dict, timeout: int) -> MagicMock:
        captured.append(json)
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {
            "output": {
                "embeddings": [{"text_index": 0, "embedding": [0.1, 0.2, 0.3]}],
            }
        }
        return resp

    ep = EmbeddingProvider()
    with patch("app.fyv_shared.embedding_provider.requests.post", side_effect=fake_post):
        out = ep.embed_query_vectors(["用户问了什么？"], scenario="notes_ask")

    assert len(out) == 1
    assert out[0].dense
    assert captured
    body = captured[0]
    assert body["model"] == "text-embedding-v4"
    assert body["input"]["texts"] == ["用户问了什么？"]
    assert body["parameters"]["text_type"] == "query"
    assert body["parameters"]["dimension"] == 1024
    assert body["parameters"]["instruct"] == "Given a query, retrieve notes"


def test_embed_texts_document_native_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_EMBEDDING_PROVIDER", "api")
    monkeypatch.setenv("RAG_EMBEDDING_MODEL", "text-embedding-v4")
    monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "sk-test")
    monkeypatch.setenv("RAG_EMBEDDING_MINIMAX_FALLBACK", "0")
    monkeypatch.setenv("RAG_EMBEDDING_QUERY_CACHE", "0")

    captured: list[dict] = []

    def fake_post(url: str, json: dict, headers: dict, timeout: int) -> MagicMock:
        captured.append(json)
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {
            "output": {
                "embeddings": [{"text_index": 0, "embedding": [0.5]}],
            }
        }
        return resp

    ep = EmbeddingProvider()
    with patch("app.fyv_shared.embedding_provider.requests.post", side_effect=fake_post):
        docs = ep.embed_documents(["笔记正文块"])

    assert docs[0].dense == [0.5]
    assert captured[0]["parameters"]["text_type"] == "document"
    assert "instruct" not in captured[0]["parameters"]
