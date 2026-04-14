import hashlib
import logging
import math
import os
import re
import json
from typing import Any, List

import requests


def _parse_embedding_response_to_vectors(payload_json: Any, num_texts: int) -> List[List[float]]:
    """
    解析 OpenAI 兼容及其它常见变体（如顶层 embedding、embeddings[][]、MiniMax base_resp 包裹等）。
    """
    if not isinstance(payload_json, dict):
        raise RuntimeError("embedding api 返回非 JSON 对象")

    br = payload_json.get("base_resp")
    if isinstance(br, dict):
        code = br.get("status_code")
        if code not in (None, 0, "0"):
            msg = br.get("status_msg") or str(br)
            raise RuntimeError(f"embedding api 业务错误: {msg}")

    candidates: list[dict[str, Any]] = [payload_json]
    for k in ("result", "response", "payload"):
        inner = payload_json.get(k)
        if isinstance(inner, dict):
            candidates.append(inner)

    last_keys: list[str] = []
    for root in candidates:
        last_keys = list(root.keys())[:24]

        data = root.get("data")
        if isinstance(data, list) and data:
            vectors: List[List[float]] = []
            for item in data:
                if isinstance(item, dict):
                    emb = item.get("embedding")
                    if isinstance(emb, list) and emb:
                        vectors.append([float(x) for x in emb])
                elif isinstance(item, list) and item and isinstance(item[0], (int, float)):
                    vectors.append([float(x) for x in item])
            if len(vectors) == num_texts:
                return vectors
        if isinstance(data, dict):
            for key in ("embeddings", "vectors", "embedding"):
                block = data.get(key)
                if isinstance(block, list) and block:
                    try:
                        parsed = _parse_embedding_response_to_vectors({"data": block}, num_texts)
                        if len(parsed) == num_texts:
                            return parsed
                    except RuntimeError:
                        pass

        emb = root.get("embedding")
        if isinstance(emb, list) and emb and isinstance(emb[0], (int, float)):
            if num_texts == 1:
                return [[float(x) for x in emb]]

        embs = root.get("embeddings")
        if isinstance(embs, list) and embs:
            out: List[List[float]] = []
            for e in embs:
                if isinstance(e, list) and e and isinstance(e[0], (int, float)):
                    out.append([float(x) for x in e])
            if len(out) == num_texts:
                return out

        vecs = root.get("vectors")
        if isinstance(vecs, list) and vecs:
            out2: List[List[float]] = []
            for v in vecs:
                if isinstance(v, dict):
                    emb = v.get("embedding") or v.get("vector")
                    if isinstance(emb, list) and emb:
                        out2.append([float(x) for x in emb])
                elif isinstance(v, list) and v and isinstance(v[0], (int, float)):
                    out2.append([float(x) for x in v])
            if len(out2) == num_texts:
                return out2

    raise RuntimeError(
        "embedding api 返回格式异常：无法解析向量（顶层 keys=%s）" % last_keys
    )


def embedding_env_fingerprint() -> str:
    """
    与向量语义空间相关的配置指纹（不含 API Key）。
    变更 RAG_EMBEDDING_* 后指纹变化，用于判定已入库向量是否需重索引。
    """
    parts = [
        (os.getenv("RAG_EMBEDDING_PROVIDER") or "api").strip().lower(),
        (os.getenv("RAG_EMBEDDING_API_URL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_MODEL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_BASE") or "").strip(),
        (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_MODEL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_LOCAL_MODEL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_MINIMAX_FALLBACK_MODEL") or "").strip(),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
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

    def embedding_signature(self, vector_dim: int) -> str:
        """
        与入库 note_rag_embedding_sig 比对；backend、维度或相关 env 变化即不匹配，应重索引。
        """
        dim = int(vector_dim)
        if dim <= 0:
            return ""
        return f"v1|{self.active_backend()}|{dim}|{embedding_env_fingerprint()}"

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        texts = [str(t or "") for t in (texts or [])]
        # 部分厂商拒绝空串；保持条数不变以便与 chunk 对齐
        texts = [s if s.strip() else " " for s in texts]
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
        url_l = (url or "").lower()
        model_l = (model or "").lower()
        # MiniMax / 部分网关要求 `texts`；OpenAI 兼容为 `input`。统一多形态尝试，避免代理 URL 不含 minimax 时误先发 input。
        prefers_texts = (
            "minimax" in url_l
            or "minimaxi" in url_l
            or model_l.startswith("embo")
            or (os.getenv("RAG_EMBEDDING_TEXTS_FIRST") or "").strip().lower() in ("1", "true", "yes")
        )
        candidate_bodies: list[dict[str, Any]] = []
        if prefers_texts:
            candidate_bodies.extend(
                [
                    {"model": model, "texts": texts, "type": "db"},
                    {"model": model, "texts": texts},
                    {"model": model, "input": texts},
                    {"model": model, "text": texts},
                ]
            )
        else:
            candidate_bodies.extend(
                [
                    {"model": model, "input": texts},
                    {"model": model, "texts": texts, "type": "db"},
                    {"model": model, "texts": texts},
                    {"model": model, "text": texts},
                ]
            )
        last_err: Exception | None = None
        seen: set[str] = set()
        for body in candidate_bodies:
            try:
                sig = json.dumps(body, sort_keys=True, ensure_ascii=True)
                if sig in seen:
                    continue
                seen.add(sig)
                resp = requests.post(
                    url,
                    json=body,
                    headers=headers,
                    timeout=self.api_timeout,
                )
                resp.raise_for_status()
                payload_json = resp.json()
                return _parse_embedding_response_to_vectors(payload_json, len(texts))
            except Exception as exc:
                last_err = exc
                logger.warning("embedding body variant failed (%s): %s", url[:48], exc)
                continue
        raise RuntimeError(f"embedding api 请求失败: {last_err}")

    def _embed_with_local(self, texts: List[str]) -> List[List[float]]:
        if self._local_model is None and not self._try_load_local():
            raise RuntimeError("本地 embedding 模型加载失败")
        arr = self._local_model.encode(texts, normalize_embeddings=True)  # type: ignore
        return [[float(x) for x in row] for row in arr]
