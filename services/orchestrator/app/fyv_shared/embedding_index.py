"""笔记 RAG 索引：统一文档向量嵌入。"""
from __future__ import annotations

import logging
from typing import Any

from .embedding_batch_async import embed_documents_offline_batch, should_use_offline_batch
from .embedding_provider import EmbeddingProvider
from .embedding_types import DocumentEmbeddings

logger = logging.getLogger(__name__)


def embed_document_chunks(
    ep: EmbeddingProvider,
    texts: list[str],
    *,
    max_chars: int = 8000,
) -> list[DocumentEmbeddings]:
    """为索引切块生成向量；大块数时可选离线路径。"""
    clipped = [str(t or "")[:max_chars] for t in texts]
    if not clipped:
        return []
    if ep.active_backend() == "api" and should_use_offline_batch(len(clipped)):
        try:
            return embed_documents_offline_batch(clipped, api_key=ep.api_key, timeout_sec=ep.api_timeout)
        except Exception as exc:
            logger.warning("offline batch embed failed, fallback sync: %s", exc)
    return ep.embed_documents(clipped)


def embed_document_chunks_batched(
    ep: EmbeddingProvider,
    texts: list[str],
    *,
    batch_size: int = 32,
    max_chars: int = 8000,
    count_api_chars: bool = False,
) -> tuple[list[DocumentEmbeddings], int]:
    """分批嵌入文档块；返回 (向量列表, api 输入字符数)。"""
    out: list[DocumentEmbeddings] = []
    api_chars = 0
    for i in range(0, len(texts), max(1, batch_size)):
        batch_texts = [str(t or "")[:max_chars] for t in texts[i : i + batch_size]]
        if count_api_chars and ep.active_backend() == "api":
            api_chars += sum(len(t) for t in batch_texts)
        out.extend(embed_document_chunks(ep, batch_texts, max_chars=max_chars))
    return out, api_chars


def merge_meta_with_sparse(meta: dict[str, Any] | None, doc: DocumentEmbeddings) -> dict[str, Any]:
    out = dict(meta) if isinstance(meta, dict) else {}
    out.update(doc.sparse_patch_for_meta())
    return out
