"""百炼离线索引：异步文件批处理（text-embedding-async-v*）。"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any

import requests

from .embedding_sparse import normalize_sparse_items
from .embedding_types import DocumentEmbeddings

logger = logging.getLogger(__name__)

_TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks"
_EMBED_URL = "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"


def offline_batch_enabled() -> bool:
    mode = (os.getenv("RAG_EMBEDDING_OFFLINE_BATCH") or "0").strip().lower()
    return mode in ("1", "true", "yes", "async")


def offline_batch_min_chunks() -> int:
    try:
        return max(16, int(os.getenv("RAG_EMBEDDING_OFFLINE_BATCH_MIN_CHUNKS", "64") or "64"))
    except (TypeError, ValueError):
        return 64


def offline_batch_model() -> str:
    return (os.getenv("RAG_EMBEDDING_BATCH_MODEL") or "text-embedding-async-v2").strip()


def should_use_offline_batch(chunk_count: int) -> bool:
    if not offline_batch_enabled():
        return False
    if chunk_count < offline_batch_min_chunks():
        return False
    primary = (os.getenv("RAG_EMBEDDING_MODEL") or "text-embedding-v4").strip().lower()
    if "text-embedding-v4" in primary or "text-embedding-v3" in primary:
        force = (os.getenv("RAG_EMBEDDING_OFFLINE_BATCH_FORCE") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if not force:
            logger.info(
                "offline batch skipped: primary model %s; set RAG_EMBEDDING_OFFLINE_BATCH_FORCE=1 to use %s",
                primary,
                offline_batch_model(),
            )
            return False
    return True


def _line_for_batch_file(text: str) -> str:
    return (text or "").replace("\r\n", "\n").replace("\n", " ").strip()[:12_000]


def _upload_batch_input_file(texts: list[str]) -> str:
    from app.object_store import presigned_get_url, upload_bytes

    lines = [_line_for_batch_file(t) for t in texts]
    body = ("\n".join(lines) + "\n").encode("utf-8")
    key = f"rag-embed-batch/{time.strftime('%Y%m%d')}/{uuid.uuid4().hex}.txt"
    upload_bytes(key, body, "text/plain; charset=utf-8")
    url = presigned_get_url(key, expires_in=86_400)
    if not url:
        raise RuntimeError("batch_input_presign_failed")
    return url


def _submit_async_batch(
    *,
    api_key: str,
    file_url: str,
    model: str,
    text_type: str = "document",
    timeout_sec: int = 30,
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    body = {
        "model": model,
        "input": {"url": file_url},
        "parameters": {"text_type": text_type},
    }
    resp = requests.post(_EMBED_URL, json=body, headers=headers, timeout=timeout_sec)
    resp.raise_for_status()
    payload = resp.json()
    output = payload.get("output") if isinstance(payload, dict) else None
    task_id = output.get("task_id") if isinstance(output, dict) else None
    if not task_id:
        raise RuntimeError(f"batch_submit_no_task_id: {payload!s}"[:300])
    return str(task_id)


def _poll_batch_task(*, api_key: str, task_id: str, timeout_sec: int = 25) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.time() + max(60, int(os.getenv("RAG_EMBEDDING_OFFLINE_BATCH_POLL_SEC", "900") or "900"))
    interval = max(2.0, float(os.getenv("RAG_EMBEDDING_OFFLINE_BATCH_INTERVAL_SEC", "4") or "4"))
    last: dict[str, Any] = {}
    while time.time() < deadline:
        resp = requests.get(f"{_TASK_URL}/{task_id}", headers=headers, timeout=timeout_sec)
        resp.raise_for_status()
        payload = resp.json()
        if not isinstance(payload, dict):
            raise RuntimeError("batch_poll_invalid_json")
        last = payload
        output = payload.get("output")
        if not isinstance(output, dict):
            time.sleep(interval)
            continue
        status = str(output.get("task_status") or "").upper()
        if status in ("SUCCEEDED", "SUCCESS"):
            return output
        if status in ("FAILED", "CANCELED", "UNKNOWN"):
            raise RuntimeError(
                f"batch_task_{status.lower()}: {output.get('message') or output.get('code') or ''}"[:300]
            )
        time.sleep(interval)
    raise RuntimeError(f"batch_task_timeout: {last!s}"[:300])


def _download_batch_vectors(result_url: str, *, expected: int, timeout_sec: int = 60) -> list[DocumentEmbeddings]:
    resp = requests.get(result_url, timeout=timeout_sec)
    resp.raise_for_status()
    text = resp.text
    vectors: list[DocumentEmbeddings] = []
    stripped = text.strip()
    if not stripped:
        raise RuntimeError("batch_result_empty")

    if stripped.startswith("["):
        data = json.loads(stripped)
        if not isinstance(data, list):
            raise RuntimeError("batch_result_not_list")
        for item in data:
            vectors.append(_item_to_document_emb(item))
    else:
        for line in stripped.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            vectors.append(_item_to_document_emb(item))

    if len(vectors) != expected:
        raise RuntimeError(f"batch_result_count_mismatch:{len(vectors)}!={expected}")
    return vectors


def _item_to_document_emb(item: Any) -> DocumentEmbeddings:
    if isinstance(item, list):
        return DocumentEmbeddings(dense=[float(x) for x in item], sparse=[])
    if not isinstance(item, dict):
        raise RuntimeError("batch_item_invalid")
    emb = item.get("embedding")
    if not isinstance(emb, list) or not emb:
        raise RuntimeError("batch_item_no_embedding")
    sparse = normalize_sparse_items(item.get("sparse_embedding"))
    return DocumentEmbeddings(dense=[float(x) for x in emb], sparse=sparse)


def embed_documents_offline_batch(
    texts: list[str],
    *,
    api_key: str,
    timeout_sec: int = 30,
) -> list[DocumentEmbeddings]:
    if not texts:
        return []
    file_url = _upload_batch_input_file(texts)
    model = offline_batch_model()
    task_id = _submit_async_batch(
        api_key=api_key,
        file_url=file_url,
        model=model,
        text_type="document",
        timeout_sec=timeout_sec,
    )
    output = _poll_batch_task(api_key=api_key, task_id=task_id, timeout_sec=timeout_sec)
    result_url = str(output.get("url") or "").strip()
    if not result_url:
        raise RuntimeError("batch_result_url_missing")
    return _download_batch_vectors(result_url, expected=len(texts), timeout_sec=max(60, timeout_sec * 2))
