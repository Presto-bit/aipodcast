"""播客脚本生成结果缓存（Redis）。仅在不使用流式 delta 回调时读写，避免刷屏事件与缓存不一致。"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Callable

from .text_decode import safe_decode_bytes

logger = logging.getLogger(__name__)


def script_cache_ttl_sec() -> int:
    raw = (os.getenv("SCRIPT_CACHE_TTL_SEC") or "0").strip()
    try:
        n = int(raw)
    except ValueError:
        return 0
    return max(0, min(86400 * 2, n))


def _cache_key(
    *,
    text: str,
    opts: dict[str, Any],
    tier: str,
    provider: str,
    force_fallback: bool,
) -> str:
    """稳定哈希：同一素材+同一约束+同一套餐+同一文本提供方即复用。"""
    payload = {
        "t": (text or "")[:500_000],
        "opts": opts,
        "tier": (tier or "free").strip().lower(),
        "provider": (provider or "").strip().lower(),
        "fb": bool(force_fallback),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    h = hashlib.sha256(raw).hexdigest()
    return f"v1:script:{h}"


def cache_get(key: str) -> dict[str, Any] | None:
    try:
        from .queue import redis_conn

        blob = redis_conn.get(key)
        if not blob:
            return None
        if isinstance(blob, (bytes, bytearray)):
            blob = safe_decode_bytes(blob)
        data = json.loads(blob)
        return data if isinstance(data, dict) else None
    except Exception as exc:
        logger.debug("script_cache get miss: %s", exc)
        return None


def cache_set(key: str, value: dict[str, Any], ttl: int) -> None:
    if ttl <= 0:
        return
    try:
        from .queue import redis_conn

        redis_conn.setex(key, ttl, json.dumps(value, ensure_ascii=False, default=str))
    except Exception as exc:
        logger.warning("script_cache set failed: %s", exc)


def get_or_build(
    *,
    text: str,
    opts: dict[str, Any],
    tier: str,
    provider: str,
    force_fallback: bool,
    builder: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    ttl = script_cache_ttl_sec()
    if ttl <= 0:
        return builder()
    key = _cache_key(text=text, opts=opts, tier=tier, provider=provider, force_fallback=force_fallback)
    hit = cache_get(key)
    if hit and str(hit.get("script") or "").strip():
        return hit
    out = builder()
    if str(out.get("script") or "").strip() and not out.get("fallback"):
        cache_set(key, out, ttl)
    return out
