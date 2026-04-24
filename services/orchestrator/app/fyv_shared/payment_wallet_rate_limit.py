"""钱包支付宝下单 / 异步通知：进程内滑动窗口限流（多副本各自计数；生产可再在网关或 Redis 叠加）。"""

from __future__ import annotations

import os
import threading
import time
from typing import Tuple

_lock = threading.Lock()
_phone_hits: dict[str, list[float]] = {}
_notify_ip_hits: dict[str, list[float]] = {}


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _sliding_allow(bucket: dict[str, list[float]], key: str, limit: int, window_sec: float) -> Tuple[bool, int]:
    now = time.monotonic()
    k = (key or "").strip() or "unknown"
    with _lock:
        q = bucket.setdefault(k, [])
        q[:] = [t for t in q if now - t < window_sec]
        if len(q) >= limit:
            wait = int(window_sec - (now - q[0])) + 1
            return False, max(1, wait)
        q.append(now)
    return True, 0


def check_wallet_alipay_create_rate_limit_for_phone(phone: str) -> Tuple[bool, int]:
    """同一账号创建支付宝充值会话：默认每 60s 最多 12 次。"""
    limit = _env_int("FYV_WALLET_ALIPAY_CREATE_PER_PHONE_PER_MIN", 12)
    if limit <= 0:
        return True, 0
    p = (phone or "").strip() or "unknown"
    return _sliding_allow(_phone_hits, f"wal_alipay_phone:{p}", limit, 60.0)


def check_alipay_notify_rate_limit(client_ip: str) -> Tuple[bool, int]:
    """异步通知按客户端 IP（经 BFF 透传 x-fym-client-ip）：默认每 60s 最多 400 次。"""
    limit = _env_int("FYV_ALIPAY_NOTIFY_PER_IP_PER_MIN", 400)
    if limit <= 0:
        return True, 0
    ip = (client_ip or "").strip() or "unknown"
    return _sliding_allow(_notify_ip_hits, f"alipay_notify:{ip}", limit, 60.0)
