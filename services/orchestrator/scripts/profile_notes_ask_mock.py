#!/usr/bin/env python3
"""
离线压测知识库检索子阶段（不连真实 PG / 不向量化 API 发请求）。

用法（在 services/orchestrator 下）:
  NOTES_ASK_PROFILE=1 PYTHONPATH=. python scripts/profile_notes_ask_mock.py

通过 mock 大块行数 + 模拟 embed 固定延迟，观察日志里各 phase 的 elapsed_ms 占比。
"""
from __future__ import annotations

import logging
import os
import sys
import time
import unittest.mock as mock
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ["NOTES_ASK_PROFILE"] = "1"
# 避免导入 embedding 时走真实 API；实际由下方 patch embed_texts 覆盖
os.environ.setdefault("RAG_EMBEDDING_PROVIDER", "hash")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from app.fyv_shared.embedding_provider import EmbeddingProvider
    from app.note_rag_service import retrieve_chunks_across_notes

    dim = 64
    n1, n2 = str(uuid.uuid4()), str(uuid.uuid4())
    note_ids = [n1, n2]
    n_rows = 1400
    fake_rows = [
        {
            "note_id": n1 if i % 2 == 0 else n2,
            "chunk_index": i,
            "chunk_text": "某技术文档段落讨论延迟与检索与向量粗排。" * 10 + f" row={i}",
            "note_sig": "",
        }
        for i in range(n_rows)
    ]

    def fake_embed(_self, texts):  # noqa: ANN001
        time.sleep(0.1)
        return [[(j + 1) * 0.01 / max(len(texts), 1) for j in range(dim)] for _ in texts]

    def fake_load_pairs(pairs):  # noqa: ANN001
        out: dict[tuple[str, int], list[float]] = {}
        for nid, idx in pairs:
            key = (str(nid), int(idx))
            vec = [0.0] * dim
            vec[idx % dim] = 1.0
            out[key] = vec
        return out

    with (
        mock.patch("app.note_rag_service._load_chunk_rows_light", return_value=fake_rows),
        mock.patch.object(EmbeddingProvider, "embed_texts", fake_embed),
        mock.patch("app.note_rag_service._load_embeddings_by_pairs", fake_load_pairs),
    ):
        t0 = time.perf_counter()
        text, meta, obs = retrieve_chunks_across_notes(
            note_ids=note_ids,
            query="延迟与检索哪个更慢",
            max_chars=12000,
            top_k=48,
        )
        wall_ms = (time.perf_counter() - t0) * 1000.0

    print(
        f"\n=== mock retrieve wall_ms={wall_ms:.1f} "
        f"excerpt_chars={len(text)} meta_n={len(meta)} obs_keys={list(obs.keys())[:6]}... ===\n"
    )


if __name__ == "__main__":
    main()
