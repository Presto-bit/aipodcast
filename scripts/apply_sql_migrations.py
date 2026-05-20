#!/usr/bin/env python3
"""
按文件名顺序执行 infra/postgres/init/*.sql；已应用记录写入 schema_migrations。

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

_SCHEMA_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def _ensure_migrations_table(conn) -> None:
    with get_cursor(conn) as cur:
        cur.execute(_SCHEMA_MIGRATIONS_DDL)


def _applied_filenames(conn) -> set[str]:
    with get_cursor(conn) as cur:
        cur.execute("SELECT filename FROM schema_migrations")
        rows = cur.fetchall() or []
    return {str(r["filename"]) for r in rows if r.get("filename")}


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
            _ensure_migrations_table(conn)
            applied = _applied_filenames(conn)
            ran = 0
            skipped = 0
            with get_cursor(conn) as cur:
                for path in files:
                    name = path.name
                    if name in applied:
                        skipped += 1
                        continue
                    sql = path.read_text(encoding="utf-8")
                    print(f"APPLY {name}")
                    cur.execute(sql)
                    cur.execute(
                        "INSERT INTO schema_migrations (filename) VALUES (%s)",
                        (name,),
                    )
                    ran += 1
            conn.commit()
    except Exception as exc:
        print(f"执行 migration 失败：{exc}", file=sys.stderr)
        return 1
    print(f"完成：新执行 {ran} 个，跳过已应用 {skipped} 个，共 {len(files)} 个文件。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
