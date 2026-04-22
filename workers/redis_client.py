"""
RQ worker 使用的 Redis 客户端。

redis-py 5.x 默认会在握手阶段发送 CLIENT SETINFO（标识库名/版本）；部分兼容实现或
前置代理在收到该命令后会直接关闭 TCP，表现为 ConnectionError: Connection closed by server。
默认关闭该行为；真实 Redis 不受影响。
"""
from __future__ import annotations

import os
import sys

import redis.exceptions
from redis import Redis


def make_worker_redis(redis_url: str | None = None) -> Redis:
    url = (redis_url or os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")).strip()
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
    return Redis.from_url(url, **kwargs)


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
            "  · 核对 .env.ai-native 中 REDIS_URL 与编排器一致（默认 redis://127.0.0.1:6379/0）\n"
            "  · 若使用仅支持子集的托管 Redis，可尝试：RQ_PREPARE_FOR_WORK=0\n",
            file=sys.stderr,
        )
        raise SystemExit(2) from e
