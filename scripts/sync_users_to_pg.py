#!/usr/bin/env python3
"""
将 legacy_backend/data/users.json 中的用户同步到 PostgreSQL `users` 表（按 phone UPSERT）。

用于在启用 PG 侧统计/关联时对齐账号；登录仍以 JSON 为准时可单独运行本脚本做镜像。

用法（仓库根目录，需已配置 .env.ai-native 中的 DB_*）:
  python3 scripts/sync_users_to_pg.py
  python3 scripts/sync_users_to_pg.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ORCH = os.path.join(ROOT, "services", "orchestrator")
if _ORCH not in sys.path:
    sys.path.insert(0, _ORCH)

from app.config import settings  # noqa: E402
import psycopg2  # noqa: E402
from app.fyv_shared.config import DATA_DIR  # noqa: E402


def _dsn() -> str:
    return (
        f"host={settings.db_host} port={settings.db_port} dbname={settings.db_name} "
        f"user={settings.db_user} password={settings.db_password}"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync users.json -> PostgreSQL users table")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要同步的行数，不写库")
    args = ap.parse_args()

    users_path = os.path.join(DATA_DIR, "users.json")
    if not os.path.isfile(users_path):
        print(f"未找到 {users_path}", file=sys.stderr)
        return 1

    try:
        with open(users_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"users.json JSON 无效: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"无法读取 {users_path}: {exc}", file=sys.stderr)
        return 1
    if not isinstance(raw, dict):
        print("users.json 格式错误", file=sys.stderr)
        return 1

    rows: list[tuple[str, str, str]] = []
    for phone, u in raw.items():
        if not phone or not isinstance(u, dict):
            continue
        role = str(u.get("role") or "user").strip().lower()
        if role not in ("user", "admin"):
            role = "user"
        display = str(u.get("display_name") or phone).strip() or phone
        rows.append((phone, display, role))

    if args.dry_run:
        print(f"[dry-run] 将同步 {len(rows)} 条用户记录")
        return 0

    sql = """
    INSERT INTO users (phone, display_name, role, updated_at)
    VALUES (%s, %s, %s, NOW())
    ON CONFLICT (phone) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      updated_at = NOW()
    """
    try:
        conn = psycopg2.connect(_dsn())
    except psycopg2.Error as exc:
        print(f"连接 PostgreSQL 失败: {exc}", file=sys.stderr)
        return 1
    try:
        with conn:
            with conn.cursor() as cur:
                for phone, display, role in rows:
                    cur.execute(sql, (phone, display, role))
    except psycopg2.Error as exc:
        print(f"同步写入失败: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    print(f"已同步 {len(rows)} 条用户到 PostgreSQL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
