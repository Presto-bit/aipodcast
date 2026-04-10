import hashlib
import logging
import math
import os
import re
from typing import List

import requests
from .config import MINIMAX_TEXT_API_KEY, MINIMAX_API_ENDPOINTS

logger = logging.getLogger(__name__)

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
    - api: OpenAI 兼容 embeddings；可配置多段链路（见环境变量）
    - local: sentence-transformers 本地模型
    - hash: 仅兜底（非真实 embedding）
    - auto: 优先 api -> local -> hash

    DeepSeek 官方 API 不提供标准 embeddings，勿将 base 指向 deepseek 期望出向量。
    便宜向量可填 RAG_EMBEDDING_OPENAI_COMPAT_*（任意 OpenAI 兼容服务），失败则按
    RAG_EMBEDDING_MINIMAX_FALLBACK 回退 MiniMax（与 RAG_EMBEDDING_API_URL 主配置一致时可去重）。
    """

    def __init__(self):
        self.mode = (os.getenv("RAG_EMBEDDING_PROVIDER", "api") or "api").strip().lower()
        self.api_url = (
            os.getenv("RAG_EMBEDDING_API_URL", MINIMAX_API_ENDPOINTS.get("embeddings", "https://api.minimax.chat/v1/embeddings"))
            or ""
        ).strip()
        _rag_key = (os.getenv("RAG_EMBEDDING_API_KEY") or "").strip()
        self.api_key = _rag_key if _rag_key else (MINIMAX_TEXT_API_KEY or "").strip()
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
            return self._embed_texts_api_chain(texts)
        if backend == "local":
            return self._embed_with_local(texts)
        return [_hashed_vector_dense(t) for t in texts]

    def _minimax_fallback_triple(self) -> tuple[str, str, str]:
        url = str(
            MINIMAX_API_ENDPOINTS.get("embeddings") or "https://api.minimax.chat/v1/embeddings"
        ).strip()
        key = (os.getenv("RAG_EMBEDDING_API_KEY") or "").strip() or (MINIMAX_TEXT_API_KEY or "").strip()
        model = (
            (os.getenv("RAG_EMBEDDING_MINIMAX_FALLBACK_MODEL") or os.getenv("RAG_EMBEDDING_MODEL") or "embo-01")
            or "embo-01"
        ).strip()
        return url, key, model

    @staticmethod
    def _embed_signature(url: str, key: str, model: str) -> tuple[str, str, str]:
        return (url.rstrip("/").lower(), key, model)

    def _embed_texts_api_chain(self, texts: List[str]) -> List[List[float]]:
        mm_fb = (os.getenv("RAG_EMBEDDING_MINIMAX_FALLBACK", "1") or "").strip().lower() not in (
            "0",
            "false",
            "no",
        )
        chain: list[tuple[str, str, str]] = []

        compat_base = (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_BASE") or "").strip()
        compat_key = (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_API_KEY") or "").strip()
        compat_model = (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_MODEL") or "").strip()
        if compat_base and compat_key and compat_model:
            br = compat_base.rstrip("/")
            emb_url = br if br.endswith("/embeddings") else f"{br}/embeddings"
            chain.append((emb_url, compat_key, compat_model))

        chain.append((self.api_url.strip(), self.api_key.strip(), self.api_model.strip()))

        mu, mk, mm = self._minimax_fallback_triple()
        seen: set[tuple[str, str, str]] = set()
        ordered: list[tuple[str, str, str]] = []
        for u, k, m in chain:
            sig = self._embed_signature(u, k, m)
            if not u or not k or not m or sig in seen:
                continue
            seen.add(sig)
            ordered.append((u, k, m))

        if mm_fb:
            sig_m = self._embed_signature(mu, mk, mm)
            if mu and mk and mm and sig_m not in seen:
                ordered.append((mu, mk, mm))

        last_err: Exception | None = None
        for u, k, m in ordered:
            try:
                return self._embed_post(u, k, m, texts)
            except Exception as exc:
                last_err = exc
                logger.warning("embedding attempt failed (%s): %s", u[:64], exc)
        if last_err:
            raise last_err
        raise RuntimeError("embedding_no_valid_endpoint_in_chain")

    def _embed_post(self, url: str, api_key: str, model: str, texts: List[str]) -> List[List[float]]:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload_json = None
        last_error = None
        candidate_bodies = [
            {"model": model, "input": texts},
            {"model": model, "texts": texts},
            {"model": model, "text": texts},
        ]
        for body in candidate_bodies:
            try:
                resp = requests.post(
                    url,
                    json=body,
                    headers=headers,
                    timeout=self.api_timeout,
                )
                resp.raise_for_status()
                payload_json = resp.json()
                break
            except Exception as e:
                last_error = e
                payload_json = None
        if payload_json is None:
            raise RuntimeError(f"embedding api 请求失败: {last_error}")

        data = payload_json.get("data")
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
