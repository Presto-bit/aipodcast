"""注册「发送验证码」限流：优先 Redis（多副本共享），不可用时回退进程内滑动窗口。"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Optional, Tuple

_lock = threading.Lock()
_buckets: dict[str, list[float]] = {}
_redis_cli: Optional[Any] = None
_redis_checked = False

_log = logging.getLogger(__name__)


def _limit_and_window() -> tuple[int, float]:
    raw = (os.environ.get("FYV_AUTH_REGISTER_SEND_CODE_PER_IP_PER_MIN") or "10").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 10
    if n <= 0:
        return 0, 60.0
    return n, 60.0


def _use_redis() -> bool:
    raw = (os.environ.get("FYV_AUTH_REGISTER_RATE_REDIS") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return bool((os.getenv("REDIS_URL") or "").strip())


def _get_redis():
    global _redis_cli, _redis_checked
    if _redis_checked:
        return _redis_cli
    with _lock:
        if _redis_checked:
            return _redis_cli
        _redis_checked = True
        if not _use_redis():
            return None
        try:
            import redis  # type: ignore[import-untyped]

            url = (os.getenv("REDIS_URL") or "").strip()
            if not url:
                return None
            cli = redis.from_url(url, decode_responses=True)
            cli.ping()
            _redis_cli = cli
            _log.debug("register_send_code rate limit: using Redis")
            return _redis_cli
        except Exception:
            _log.warning("register_send_code rate limit: Redis 不可用，回退内存桶", exc_info=True)
            _redis_cli = None
            return None


def _check_redis(ip: str, limit: int) -> Optional[Tuple[bool, int]]:
    """返回 None 表示应回退内存；否则 (允许, retry_after_sec)。"""
    r = _get_redis()
    if r is None:
        return None
    minute = int(time.time() // 60)
    key = f"fyv:rl:reg_send_code:{ip}:{minute}"
    try:
        n = int(r.incr(key))
        if n == 1:
            r.expire(key, 120)
        if n > limit:
            ttl = r.ttl(key)
            wait = max(1, int(ttl)) if ttl and int(ttl) > 0 else 60
            return False, wait
        return True, 0
    except Exception:
        _log.warning("register_send_code Redis 限流失败，回退内存", exc_info=True)
        return None


def _check_memory(ip: str, limit: int, window: float) -> Tuple[bool, int]:
    now = time.monotonic()
    with _lock:
        q = _buckets.setdefault(ip, [])
        q[:] = [t for t in q if now - t < window]
        if len(q) >= limit:
            oldest = q[0]
            wait = int(window - (now - oldest)) + 1
            return False, max(1, wait)
        q.append(now)
    return True, 0


def check_register_send_code_rate_limit(client_ip: str) -> Tuple[bool, int]:
    """
    返回 (允许, retry_after_sec)。
    client_ip 建议已由代理头解析为主叫 IP。
    """
    ip = (client_ip or "").strip() or "unknown"
    limit, window = _limit_and_window()
    if limit <= 0:
        return True, 0
    redis_res = _check_redis(ip, limit)
    if redis_res is not None:
        return redis_res
    return _check_memory(ip, limit, window)


def client_ip_from_request(request_headers: dict[str, str], peer_host: str | None) -> str:
    """从 ASGI/Starlette 类 headers 取 IP。"""
    xff = ""
    for k, v in request_headers.items():
        if k.lower() == "x-forwarded-for" and v:
            xff = str(v).strip()
            break
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    return (peer_host or "").strip() or "unknown"
