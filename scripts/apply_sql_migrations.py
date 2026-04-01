#!/usr/bin/env python3
"""
按文件名顺序执行 infra/postgres/init/*.sql（SQL migration 主导）。

用法：
  python3 scripts/apply_sql_migrations.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCH_DIR = ROOT / "services" / "orchestrator"
if str(ORCH_DIR) not in sys.path:
    sys.path.insert(0, str(ORCH_DIR))

from app.db import get_conn, get_cursor  # noqa: E402


def main() -> int:
    init_dir = ROOT / "infra" / "postgres" / "init"
    if not init_dir.is_dir():
        print(f"目录不存在或不是目录：{init_dir}", file=sys.stderr)
        return 1
    files = sorted(init_dir.glob("*.sql"))
    if not files:
        print(f"未找到 SQL 文件：{init_dir}", file=sys.stderr)
        return 1

    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                for path in files:
                    sql = path.read_text(encoding="utf-8")
                    print(f"APPLY {path.name}")
                    cur.execute(sql)
            conn.commit()
    except Exception as exc:
        print(f"执行 migration 失败：{exc}", file=sys.stderr)
        return 1
    print(f"完成，共执行 {len(files)} 个 migration。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
