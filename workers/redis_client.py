"""
RQ worker 使用的 Redis 客户端。

redis-py 5.x 默认会在握手阶段发送 CLIENT SETINFO（标识库名/版本）；部分兼容实现或
前置代理在收到该命令后会直接关闭 TCP，表现为 ConnectionError: Connection closed by server。
默认关闭该行为；真实 Redis 不受影响。

另：ConnectionPool.from_url 会以 URL 查询参数覆盖关键字参数。若 REDIS_URL 带
``protocol=3``，客户端会走 RESP3 HELLO 握手，部分旧版 Redis / 代理会直接断连；
此处会剥离该查询键并强制 ``protocol=2``（RESP2）。
"""
from __future__ import annotations

import os
import sys
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import redis.exceptions
from redis import Redis


def _worker_redis_url_for_pool(url: str) -> str:
    """去掉会强制 RESP3 握手的查询参数（from_url 时查询项会覆盖 kwargs）。"""
    raw = url.strip()
    u = urlparse(raw)
    if not u.query:
        return raw
    qs = parse_qs(u.query, keep_blank_values=True)
    lower = {k.lower(): k for k in qs}
    if "protocol" not in lower:
        return raw
    del qs[lower["protocol"]]
    new_q = urlencode(qs, doseq=True)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_q, u.fragment))


def make_worker_redis(redis_url: str | None = None) -> Redis:
    url = (redis_url or os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")).strip()
    pool_url = _worker_redis_url_for_pool(url)
    timeout = float(os.getenv("REDIS_SOCKET_CONNECT_TIMEOUT", "8").strip() or "8")
    # 1/true/yes：不向服务端发送 CLIENT SETINFO（默认，避免兼容层断连）
    disable_setinfo = os.getenv("REDIS_DISABLE_CLIENT_SETINFO", "1").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    kwargs: dict = {
        "socket_connect_timeout": timeout,
        "protocol": 2,
    }
    if disable_setinfo:
        kwargs["lib_name"] = None
        kwargs["lib_version"] = None
    return Redis.from_url(pool_url, **kwargs)


def ping_redis_or_exit(conn: Redis, *, role: str) -> None:
    """启动 worker 前探测；失败时打印可操作的说明并退出。"""
    try:
        conn.ping()
    except redis.exceptions.RedisError as e:
        print(
            f"[{role}] 无法连接 Redis：{e}\n"
            "常见处理：\n"
            "  · 启动 Redis：docker compose -f docker-compose.ai-native.yml up -d redis\n"
            "    或本机：redis-server / brew services start redis\n"
            "  · 核对 .env.ai-native 中 REDIS_URL 与编排器、worker 指向同一实例；Compose 服务内须为\n"
            "    redis://redis:6379/0（不要用 127.0.0.1，除非使用 host 网络且端口已映射到宿主机）\n"
            "  · 托管 Redis：确认 redis:// 与 rediss://（TLS）及端口与控制台一致\n"
            "  · 若 REDIS_URL 含查询参数 protocol=3，可能与代理/旧实例不兼容；去掉该参数或保持默认 URL\n"
            "  · 若 PING 正常但 worker 启动后立即断连，可尝试：RQ_PREPARE_FOR_WORK=0（跳过 CLIENT SETNAME）\n",
            file=sys.stderr,
        )
        raise SystemExit(2) from e
