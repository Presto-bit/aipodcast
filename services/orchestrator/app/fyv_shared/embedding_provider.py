import hashlib
import logging
import math
import os
import re
import json
from typing import Any, List

import requests

from .embedding_query_cache import get_cached_query_embeddings, set_cached_query_embeddings
from .embedding_scenarios import (
    embedding_output_type,
    query_instruct_for_scenario,
)
from .embedding_sparse import normalize_sparse_items
from .embedding_types import DEFAULT_SCENARIO, DocumentEmbeddings, EmbeddingRole, EmbeddingScenario

_DEFAULT_QUERY_INSTRUCT = (
    "Given a user question about their personal knowledge base and notes, "
    "retrieve the most relevant note passages for answering."
)

_DASHSCOPE_TEXT_EMBEDDING_NATIVE_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"
)


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

        output = root.get("output")
        if isinstance(output, dict):
            items = output.get("embeddings")
            if isinstance(items, list) and items:
                parsed_items: list[tuple[int, List[float]]] = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    emb = item.get("embedding")
                    if not isinstance(emb, list) or not emb:
                        continue
                    idx = int(item.get("text_index", len(parsed_items)))
                    parsed_items.append((idx, [float(x) for x in emb]))
                if parsed_items:
                    parsed_items.sort(key=lambda pair: pair[0])
                    vectors = [vec for _, vec in parsed_items]
                    if len(vectors) == num_texts:
                        return vectors

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
        (os.getenv("RAG_EMBEDDING_DIMENSIONS") or "").strip(),
        embedding_output_type(),
        (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_BASE") or "").strip(),
        (os.getenv("RAG_EMBEDDING_OPENAI_COMPAT_MODEL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_LOCAL_MODEL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_MINIMAX_FALLBACK_MODEL") or "").strip(),
        (os.getenv("RAG_EMBEDDING_BATCH_MODEL") or "").strip(),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _embedding_dimensions_from_env() -> int | None:
    raw = (os.getenv("RAG_EMBEDDING_DIMENSIONS") or "").strip()
    if not raw:
        return None
    try:
        dim = int(raw)
    except (TypeError, ValueError):
        return None
    return dim if dim > 0 else None


def _supports_dashscope_text_embedding_native(model: str) -> bool:
    return "text-embedding-v" in (model or "").lower()


def _dashscope_native_embedding_url() -> str:
    return (
        os.getenv("RAG_EMBEDDING_DASHSCOPE_NATIVE_URL") or _DASHSCOPE_TEXT_EMBEDDING_NATIVE_URL
    ).strip()


def _query_instruct_enabled() -> bool:
    from .embedding_scenarios import query_instruct_enabled

    return query_instruct_enabled()


def _query_instruct_from_env(scenario: EmbeddingScenario | str | None = None) -> str | None:
    return query_instruct_for_scenario(scenario or DEFAULT_SCENARIO)


def _parse_native_embedding_items(payload_json: Any, num_texts: int) -> list[DocumentEmbeddings]:
    if not isinstance(payload_json, dict):
        raise RuntimeError("embedding api 返回非 JSON 对象")
    output = payload_json.get("output")
    if not isinstance(output, dict):
        return [
            DocumentEmbeddings(dense=v, sparse=[])
            for v in _parse_embedding_response_to_vectors(payload_json, num_texts)
        ]
    items = output.get("embeddings")
    if not isinstance(items, list) or not items:
        return [
            DocumentEmbeddings(dense=v, sparse=[])
            for v in _parse_embedding_response_to_vectors(payload_json, num_texts)
        ]
    parsed_items: list[tuple[int, DocumentEmbeddings]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        emb = item.get("embedding")
        if not isinstance(emb, list) or not emb:
            continue
        idx = int(item.get("text_index", len(parsed_items)))
        sparse = normalize_sparse_items(item.get("sparse_embedding"))
        parsed_items.append((idx, DocumentEmbeddings(dense=[float(x) for x in emb], sparse=sparse)))
    if not parsed_items:
        raise RuntimeError("embedding native items empty")
    parsed_items.sort(key=lambda pair: pair[0])
    vectors = [vec for _, vec in parsed_items]
    if len(vectors) != num_texts:
        raise RuntimeError(f"embedding native count mismatch:{len(vectors)}!={num_texts}")
    return vectors


def _use_dashscope_native_for_role(role: EmbeddingRole) -> bool:
    if (os.getenv("RAG_EMBEDDING_USE_DASHSCOPE_NATIVE") or "").strip().lower() in (
        "0",
        "false",
        "no",
    ):
        return False
    if role == "query":
        return True
    return (os.getenv("RAG_EMBEDDING_DOCUMENT_NATIVE", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def _embedding_api_batch_size(model: str, url: str) -> int:
    """单次 /embeddings 请求条数上限；百炼 text-embedding-v* 默认为 10。"""
    raw = (os.getenv("RAG_EMBEDDING_API_BATCH_SIZE") or "").strip()
    if raw:
        try:
            return max(1, min(128, int(raw)))
        except (TypeError, ValueError):
            pass
    model_l = (model or "").lower()
    url_l = (url or "").lower()
    if "text-embedding-v" in model_l or "dashscope" in url_l:
        return 10
    return 32
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
    百炼 text-embedding-v4：RAG_EMBEDDING_API_URL 指向 compatible-mode/v1/embeddings，
    Key 可复用 QWEN_API_KEY；单次请求最多 10 条（RAG_EMBEDDING_API_BATCH_SIZE）。
    便宜向量可填 RAG_EMBEDDING_OPENAI_COMPAT_*（任意 OpenAI 兼容服务），失败则按
    RAG_EMBEDDING_MINIMAX_FALLBACK 回退 MiniMax（与 RAG_EMBEDDING_API_URL 主配置一致时可去重）。
    """

    def __init__(self):
        self.mode = (os.getenv("RAG_EMBEDDING_PROVIDER", "api") or "api").strip().lower()
        self.api_url = (
            os.getenv(
                "RAG_EMBEDDING_API_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
            )
            or ""
        ).strip()
        _rag_key = (os.getenv("RAG_EMBEDDING_API_KEY") or "").strip()
        if not _rag_key:
            _rag_key = (os.getenv("QWEN_API_KEY") or "").strip()
        self.api_key = _rag_key if _rag_key else (MINIMAX_TEXT_API_KEY or "").strip()
        self.api_model = (os.getenv("RAG_EMBEDDING_MODEL", "text-embedding-v4") or "").strip()
        self.api_dimensions = _embedding_dimensions_from_env()
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
        """文档/底库文本向量（text_type=document）。"""
        return [doc.dense for doc in self.embed_documents(texts)]

    def embed_documents(self, texts: List[str]) -> list[DocumentEmbeddings]:
        """文档向量；百炼 v4 可返回 dense+sparse。"""
        return self._embed_documents_with_role(texts, role="document", scenario=DEFAULT_SCENARIO)

    def embed_queries(
        self,
        texts: List[str],
        *,
        scenario: EmbeddingScenario | str = "notes_ask",
    ) -> List[List[float]]:
        """检索查询稠密向量（兼容旧调用）。"""
        return [doc.dense for doc in self.embed_query_vectors(texts, scenario=scenario)]

    def embed_query_vectors(
        self,
        texts: List[str],
        *,
        scenario: EmbeddingScenario | str = "notes_ask",
    ) -> list[DocumentEmbeddings]:
        """检索查询向量（含缓存、分场景 instruct、可选 sparse）。"""
        texts = [str(t or "") for t in (texts or [])]
        texts = [s if s.strip() else " " for s in texts]
        if not texts:
            return []
        backend = self.active_backend()
        if backend != "api":
            dense_only = self._embed_texts_with_role(texts, role="query", scenario=scenario)
            return [DocumentEmbeddings(dense=v, sparse=[]) for v in dense_only]

        fp = embedding_env_fingerprint()
        dim = self.api_dimensions or _embedding_dimensions_from_env() or 1024
        cached = get_cached_query_embeddings(
            texts, scenario=scenario, env_fingerprint=fp, dim=int(dim)
        )
        out: list[DocumentEmbeddings | None] = list(cached)
        miss_idx = [i for i, v in enumerate(out) if v is None]
        if miss_idx:
            miss_texts = [texts[i] for i in miss_idx]
            fresh = self._embed_documents_with_role(miss_texts, role="query", scenario=scenario)
            for pos, vec in zip(miss_idx, fresh):
                out[pos] = vec
            set_cached_query_embeddings(
                [texts[i] for i in miss_idx],
                fresh,
                scenario=scenario,
                env_fingerprint=fp,
                dim=int(dim),
            )
        return [v if v is not None else DocumentEmbeddings(dense=[], sparse=[]) for v in out]

    def _embed_texts_with_role(
        self,
        texts: List[str],
        *,
        role: EmbeddingRole,
        scenario: EmbeddingScenario | str = DEFAULT_SCENARIO,
    ) -> List[List[float]]:
        return [doc.dense for doc in self._embed_documents_with_role(texts, role=role, scenario=scenario)]

    def _embed_documents_with_role(
        self,
        texts: List[str],
        *,
        role: EmbeddingRole,
        scenario: EmbeddingScenario | str = DEFAULT_SCENARIO,
    ) -> list[DocumentEmbeddings]:
        texts = [str(t or "") for t in (texts or [])]
        texts = [s if s.strip() else " " for s in texts]
        if not texts:
            return []
        backend = self.active_backend()
        if backend == "api":
            return self._embed_texts_api_chain(texts, role=role, scenario=scenario)
        if backend == "local":
            arr = self._embed_with_local(texts)
            return [DocumentEmbeddings(dense=v, sparse=[]) for v in arr]
        return [DocumentEmbeddings(dense=_hashed_vector_dense(t), sparse=[]) for t in texts]

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

    def _embed_texts_api_chain(
        self,
        texts: List[str],
        *,
        role: EmbeddingRole = "document",
        scenario: EmbeddingScenario | str = DEFAULT_SCENARIO,
    ) -> list[DocumentEmbeddings]:
        if _supports_dashscope_text_embedding_native(self.api_model) and _use_dashscope_native_for_role(role):
            try:
                return self._embed_dashscope_native_batched(
                    self.api_key, self.api_model, texts, role=role, scenario=scenario
                )
            except Exception as exc:
                logger.warning("dashscope native embedding failed (%s), fallback to compat: %s", role, exc)

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
                dense_batches = self._embed_post_batched(u, k, m, texts)
                return [DocumentEmbeddings(dense=v, sparse=[]) for v in dense_batches]
            except Exception as exc:
                last_err = exc
                logger.warning("embedding attempt failed (%s): %s", u[:64], exc)
        if last_err:
            raise last_err
        raise RuntimeError("embedding_no_valid_endpoint_in_chain")

    def _embed_post_batched(self, url: str, api_key: str, model: str, texts: List[str]) -> List[List[float]]:
        batch_size = _embedding_api_batch_size(model, url)
        if len(texts) <= batch_size:
            return self._embed_post(url, api_key, model, texts)
        vectors: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            vectors.extend(self._embed_post(url, api_key, model, texts[i : i + batch_size]))
        return vectors

    def _embed_dashscope_native_batched(
        self,
        api_key: str,
        model: str,
        texts: List[str],
        *,
        role: EmbeddingRole,
        scenario: EmbeddingScenario | str = DEFAULT_SCENARIO,
    ) -> list[DocumentEmbeddings]:
        url = _dashscope_native_embedding_url()
        batch_size = _embedding_api_batch_size(model, url)
        if len(texts) <= batch_size:
            return self._embed_dashscope_native(api_key, model, texts, role=role, scenario=scenario)
        vectors: list[DocumentEmbeddings] = []
        for i in range(0, len(texts), batch_size):
            vectors.extend(
                self._embed_dashscope_native(
                    api_key, model, texts[i : i + batch_size], role=role, scenario=scenario
                )
            )
        return vectors

    def _embed_dashscope_native(
        self,
        api_key: str,
        model: str,
        texts: List[str],
        *,
        role: EmbeddingRole,
        scenario: EmbeddingScenario | str = DEFAULT_SCENARIO,
    ) -> list[DocumentEmbeddings]:
        parameters: dict[str, Any] = {"text_type": role}
        dim = self.api_dimensions if self.api_dimensions is not None else _embedding_dimensions_from_env()
        if dim is not None:
            parameters["dimension"] = int(dim)
        out_type = embedding_output_type()
        if out_type == "dense&sparse" and role == "document":
            parameters["output_type"] = "dense&sparse"
        elif out_type == "dense&sparse" and role == "query":
            parameters["output_type"] = "dense&sparse"
        if role == "query":
            instruct = _query_instruct_from_env(scenario)
            if instruct:
                parameters["instruct"] = instruct

        body = {
            "model": model,
            "input": {"texts": texts},
            "parameters": parameters,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        resp = requests.post(
            _dashscope_native_embedding_url(),
            json=body,
            headers=headers,
            timeout=self.api_timeout,
        )
        resp.raise_for_status()
        payload_json = resp.json()
        if isinstance(payload_json, dict):
            code = payload_json.get("code")
            if code not in (None, "", 0, "0"):
                raise RuntimeError(
                    f"dashscope embedding 业务错误: {payload_json.get('message') or code}"
                )
        return _parse_native_embedding_items(payload_json, len(texts))

    def _embedding_request_extras(self) -> dict[str, Any]:
        extras: dict[str, Any] = {}
        dim = self.api_dimensions if self.api_dimensions is not None else _embedding_dimensions_from_env()
        if dim is not None:
            extras["dimensions"] = int(dim)
            extras["encoding_format"] = "float"
        return extras

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
        extras = self._embedding_request_extras()
        base_bodies: list[dict[str, Any]] = []
        if prefers_texts:
            base_bodies.extend(
                [
                    {"model": model, "texts": texts, "type": "db"},
                    {"model": model, "texts": texts},
                    {"model": model, "input": texts},
                    {"model": model, "text": texts},
                ]
            )
        else:
            base_bodies.extend(
                [
                    {"model": model, "input": texts},
                    {"model": model, "texts": texts, "type": "db"},
                    {"model": model, "texts": texts},
                    {"model": model, "text": texts},
                ]
            )
        candidate_bodies: list[dict[str, Any]] = []
        for body in base_bodies:
            merged = {**body, **extras}
            candidate_bodies.append(merged)
            if extras:
                candidate_bodies.append(body)
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
