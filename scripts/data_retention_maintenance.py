#!/usr/bin/env python3
"""
数据保留与归档维护脚本（SQL 主导后，运行时可定时执行）。

默认策略：
- payment_webhook_deliveries：在线保留 180 天，归档到 payment_webhook_deliveries_archive
- usage_events：在线保留 365 天，归档到 usage_events_archive
- job_events：在线保留 365 天，归档到 job_events_archive
- subscription_events：在线保留 730 天，归档到 subscription_events_archive
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_DIR = os.path.join(ROOT, "services", "orchestrator")
if ORCH_DIR not in sys.path:
    sys.path.insert(0, ORCH_DIR)

from app.db import get_conn, get_cursor  # noqa: E402


@dataclass
class RetentionTask:
    src: str
    archive: str
    ts_col: str
    keep_days: int


def _env_days(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return default


def _tasks() -> list[RetentionTask]:
    return [
        RetentionTask(
            src="payment_webhook_deliveries",
            archive="payment_webhook_deliveries_archive",
            ts_col="last_received_at",
            keep_days=_env_days("RETENTION_PAYMENT_WEBHOOK_DAYS", 180),
        ),
        RetentionTask(
            src="usage_events",
            archive="usage_events_archive",
            ts_col="created_at",
            keep_days=_env_days("RETENTION_USAGE_EVENTS_DAYS", 365),
        ),
        RetentionTask(
            src="job_events",
            archive="job_events_archive",
            ts_col="created_at",
            keep_days=_env_days("RETENTION_JOB_EVENTS_DAYS", 365),
        ),
        RetentionTask(
            src="subscription_events",
            archive="subscription_events_archive",
            ts_col="created_at",
            keep_days=_env_days("RETENTION_SUBSCRIPTION_EVENTS_DAYS", 730),
        ),
    ]


def _preview(cur, task: RetentionTask) -> int:
    cur.execute(
        f"SELECT COUNT(*)::bigint AS n FROM {task.src} WHERE {task.ts_col} < NOW() - (%s || ' days')::interval",
        (task.keep_days,),
    )
    row = cur.fetchone() or {}
    return int(row.get("n") or 0)


def _archive_and_delete(cur, task: RetentionTask) -> int:
    cur.execute(
        f"""
        WITH moved AS (
          INSERT INTO {task.archive}
          SELECT *
          FROM {task.src}
          WHERE {task.ts_col} < NOW() - (%s || ' days')::interval
          RETURNING 1
        )
        SELECT COUNT(*)::bigint AS n FROM moved
        """,
        (task.keep_days,),
    )
    moved = int((cur.fetchone() or {}).get("n") or 0)
    cur.execute(
        f"DELETE FROM {task.src} WHERE {task.ts_col} < NOW() - (%s || ' days')::interval",
        (task.keep_days,),
    )
    return moved


def main() -> int:
    ap = argparse.ArgumentParser(description="Archive and purge old runtime rows")
    ap.add_argument("--dry-run", action="store_true", help="仅预览，不写入")
    args = ap.parse_args()

    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                total = 0
                for task in _tasks():
                    if args.dry_run:
                        n = _preview(cur, task)
                        print(f"[dry-run] {task.src}: will move {n} rows (keep_days={task.keep_days})")
                        total += n
                    else:
                        n = _archive_and_delete(cur, task)
                        print(f"{task.src}: moved {n} rows (keep_days={task.keep_days})")
                        total += n
                if args.dry_run:
                    conn.rollback()
                else:
                    conn.commit()
    except Exception as exc:
        print(f"维护任务失败: {exc}", file=sys.stderr)
        return 1
    print(f"done total_rows={total} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
