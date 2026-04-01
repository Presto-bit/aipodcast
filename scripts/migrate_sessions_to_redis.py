#!/usr/bin/env python3
"""
将 legacy_backend/data/sessions.json 会话迁移到 Redis。

用法：
  python3 scripts/migrate_sessions_to_redis.py --dry-run
  python3 scripts/migrate_sessions_to_redis.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ORCH = os.path.join(ROOT, "services", "orchestrator")
if _ORCH not in sys.path:
    sys.path.insert(0, _ORCH)

from app.fyv_shared.config import DATA_DIR  # noqa: E402

try:
    from redis import Redis  # noqa: E402
except ImportError:
    Redis = None  # type: ignore[misc,assignment]


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate legacy sessions.json to Redis")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if Redis is None:
        print("缺少 redis 包，无法迁移。", file=sys.stderr)
        return 1
    redis_url = (os.environ.get("REDIS_URL") or "").strip()
    if not redis_url:
        print("缺少 REDIS_URL，无法迁移。", file=sys.stderr)
        return 1

    path = os.path.join(DATA_DIR, "sessions.json")
    if not os.path.isfile(path):
        print(f"未找到 {path}，无需迁移。")
        return 0

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw: Any = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"sessions.json JSON 无效: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"无法读取 {path}: {exc}", file=sys.stderr)
        return 1
    if not isinstance(raw, dict):
        print("sessions.json 格式错误（须为对象）。", file=sys.stderr)
        return 1

    now = time.time()
    rows: list[tuple[str, dict[str, Any], int]] = []
    for token, sess in raw.items():
        if not isinstance(sess, dict):
            continue
        exp = float(sess.get("expires") or 0)
        ttl = int(exp - now)
        if ttl <= 0:
            continue
        rows.append((str(token), sess, ttl))

    print(f"可迁移会话数: {len(rows)}")
    if args.dry_run:
        print("[dry-run] 仅预览，不写入 Redis")
        return 0

    try:
        cli = Redis.from_url(redis_url, decode_responses=True)
        cli.ping()
        pipe = cli.pipeline()
        for token, sess, ttl in rows:
            key = f"fym:auth:session:{token}"
            pipe.set(key, json.dumps(sess, ensure_ascii=False), ex=max(1, ttl))
        pipe.execute()
    except Exception as exc:
        print(f"写入 Redis 失败: {exc}", file=sys.stderr)
        return 1
    print(f"已迁移 {len(rows)} 条会话到 Redis")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
