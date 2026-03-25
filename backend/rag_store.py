"""
向量存储（SQLite + 真实 embedding，可切换 API/本地）。
"""

import json
import math
import os
import sqlite3
from typing import Dict, List, Tuple

from embedding_provider import EmbeddingProvider

def _cosine_dense(a: List[float], b: List[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n <= 0:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(n):
        x = float(a[i])
        y = float(b[i])
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


class RagStore:
    def __init__(self, db_path: str):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db_path = db_path
        self.embedding_provider = EmbeddingProvider()
        self._init_db()

    def _connect(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    doc_id TEXT NOT NULL,
                    chunk_idx INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    vec_json TEXT NOT NULL,
                    PRIMARY KEY (doc_id, chunk_idx)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rag_doc ON rag_chunks(doc_id)")
            conn.commit()

    def upsert_document(self, doc_id: str, chunks: List[str]) -> int:
        if not doc_id or not chunks:
            return 0
        vectors = self.embedding_provider.embed_texts(chunks)
        if len(vectors) != len(chunks):
            return 0
        with self._connect() as conn:
            conn.execute("DELETE FROM rag_chunks WHERE doc_id = ?", (doc_id,))
            rows = []
            for i, ch in enumerate(chunks, start=1):
                vec = vectors[i - 1]
                rows.append((doc_id, i, ch, json.dumps(vec, ensure_ascii=False)))
            conn.executemany(
                "INSERT INTO rag_chunks(doc_id, chunk_idx, content, vec_json) VALUES (?, ?, ?, ?)",
                rows,
            )
            conn.commit()
        return len(chunks)

    def search(self, doc_id: str, query_text: str, top_k: int = 12) -> List[Dict]:
        if not doc_id:
            return []
        qv_list = self.embedding_provider.embed_texts([query_text])
        qv = qv_list[0] if qv_list else []
        scored: List[Tuple[float, int, str]] = []
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT chunk_idx, content, vec_json FROM rag_chunks WHERE doc_id = ?",
                (doc_id,),
            )
            for idx, content, vec_json in cur.fetchall():
                try:
                    raw = json.loads(vec_json)
                    if isinstance(raw, list):
                        cv = [float(v) for v in raw]
                    elif isinstance(raw, dict):
                        # 兼容旧版稀疏存储，尽量转成稠密向量比较
                        max_key = max((int(k) for k in raw.keys()), default=-1)
                        cv = [0.0] * (max_key + 1 if max_key >= 0 else 0)
                        for k, v in raw.items():
                            ik = int(k)
                            if 0 <= ik < len(cv):
                                cv[ik] = float(v)
                    else:
                        cv = []
                except Exception:
                    cv = []
                s = _cosine_dense(qv, cv)
                scored.append((s, int(idx), content))
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[: max(1, top_k)]
        top = sorted(top, key=lambda x: x[1])
        return [{"chunk_index": i, "score": s, "content": c} for s, i, c in top]
