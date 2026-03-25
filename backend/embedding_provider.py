import hashlib
import math
import os
import re
from typing import List

import requests
from config import MINIMAX_TEXT_API_KEY, MINIMAX_API_ENDPOINTS


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z0-9_]+", (text or "").lower())


def _hashed_vector_dense(text: str, dim: int = 256) -> List[float]:
    vec = [0.0] * dim
    for tok in _tokenize(text):
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16) % dim
        vec[h] += 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


class EmbeddingProvider:
    """
    统一 embedding 入口：
    - api: OpenAI 兼容 embeddings 接口
    - local: sentence-transformers 本地模型
    - hash: 仅兜底（非真实 embedding）
    - auto: 优先 api -> local -> hash
    """

    def __init__(self):
        self.mode = (os.getenv("RAG_EMBEDDING_PROVIDER", "api") or "api").strip().lower()
        self.api_url = (
            os.getenv("RAG_EMBEDDING_API_URL", MINIMAX_API_ENDPOINTS.get("embeddings", "https://api.minimaxi.com/v1/embeddings"))
            or ""
        ).strip()
        self.api_key = (os.getenv("RAG_EMBEDDING_API_KEY", MINIMAX_TEXT_API_KEY) or "").strip()
        self.api_model = (os.getenv("RAG_EMBEDDING_MODEL", "embo-01") or "").strip()
        self.api_timeout = int(os.getenv("RAG_EMBEDDING_TIMEOUT_SEC", "25") or "25")
        self.local_model_name = (os.getenv("RAG_EMBEDDING_LOCAL_MODEL", "BAAI/bge-small-zh-v1.5") or "").strip()
        self._local_model = None

    def _should_use_api(self) -> bool:
        return bool(self.api_url and self.api_model and self.api_key)

    def _try_load_local(self) -> bool:
        if self._local_model is not None:
            return True
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
            self._local_model = SentenceTransformer(self.local_model_name)
            return True
        except Exception:
            self._local_model = None
            return False

    def active_backend(self) -> str:
        if self.mode == "api":
            return "api" if self._should_use_api() else "hash"
        if self.mode == "local":
            return "local" if self._try_load_local() else "hash"
        if self.mode == "hash":
            return "hash"
        # auto
        if self._should_use_api():
            return "api"
        if self._try_load_local():
            return "local"
        return "hash"

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        texts = [str(t or "") for t in (texts or [])]
        if not texts:
            return []
        backend = self.active_backend()
        if backend == "api":
            return self._embed_with_api(texts)
        if backend == "local":
            return self._embed_with_local(texts)
        return [_hashed_vector_dense(t) for t in texts]

    def _embed_with_api(self, texts: List[str]) -> List[List[float]]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = None
        last_error = None
        candidate_bodies = [
            {"model": self.api_model, "input": texts},
            {"model": self.api_model, "texts": texts},
            {"model": self.api_model, "text": texts},
        ]
        for body in candidate_bodies:
            try:
                resp = requests.post(
                    self.api_url,
                    json=body,
                    headers=headers,
                    timeout=self.api_timeout,
                )
                resp.raise_for_status()
                payload = resp.json()
                break
            except Exception as e:
                last_error = e
                payload = None
        if payload is None:
            raise RuntimeError(f"embedding api 请求失败: {last_error}")

        data = payload.get("data")
        if not isinstance(data, list):
            raise RuntimeError("embedding api 返回格式异常：缺少 data")
        vectors: List[List[float]] = []
        for item in data:
            emb = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(emb, list):
                raise RuntimeError("embedding api 返回格式异常：embedding 非数组")
            vectors.append([float(x) for x in emb])
        if len(vectors) != len(texts):
            raise RuntimeError("embedding api 返回条数与输入不一致")
        return vectors

    def _embed_with_local(self, texts: List[str]) -> List[List[float]]:
        if self._local_model is None and not self._try_load_local():
            raise RuntimeError("本地 embedding 模型加载失败")
        arr = self._local_model.encode(texts, normalize_embeddings=True)  # type: ignore
        return [[float(x) for x in row] for row in arr]
