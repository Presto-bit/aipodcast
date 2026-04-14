#!/usr/bin/env python3
"""
运维排障：使用仓库根目录 .env.ai-native 中的 DB_* 与 REDIS_URL，查询 PostgreSQL 中的任务行、
最近 job_events，并尝试解析 RQ 任务状态（若事件中含 rq_job_id）。

用法（在可访问数据库与 Redis 的主机上，于仓库根目录执行）：

  python3 scripts/inspect_job.py 0fd4651b-e8b0-41ab-aa20-3de8a55d6ae4

安全：不向 stdout 打印数据库密码；payload 仅摘要展示长度与键名。

若需显式允许对非本机库执行（避免误连生产），可设置：

  export ALLOW_JOB_INSPECT=1
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
ORCH = ROOT / "services" / "orchestrator"
if str(ORCH) not in sys.path:
    sys.path.insert(0, str(ORCH))


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env.ai-native", override=False)
    load_dotenv(".env.ai-native", override=False)


def _payload_summary(payload: Any) -> str:
    if payload is None:
        return "{}"
    if isinstance(payload, dict):
        keys = list(payload.keys())[:12]
        extra = f"+{len(payload) - len(keys)} keys" if len(payload) > len(keys) else ""
        return f"keys={keys}{' ' + extra if extra else ''}"
    s = str(payload)
    return s[:200] + ("…" if len(s) > 200 else "")


def _find_latest_rq_job_id(events: list[dict[str, Any]]) -> str | None:
    """同一任务可能多次入队（运维重试）；取事件序列中最后一次出现的 rq_job_id。"""
    last: str | None = None
    for ev in events:
        raw = ev.get("event_payload")
        if raw is None:
            continue
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        if isinstance(raw, dict) and raw.get("rq_job_id"):
            last = str(raw["rq_job_id"]).strip() or last
    return last


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect job row, events, and optional RQ status.")
    parser.add_argument("job_id", help="jobs.id (UUID)")
    parser.add_argument("--events-limit", type=int, default=40, help="Max job_events rows to print")
    args = parser.parse_args()

    jid = (args.job_id or "").strip()
    if len(jid) < 32:
        print("job_id 无效", file=sys.stderr)
        return 2

    _load_env()

    if os.getenv("ALLOW_JOB_INSPECT", "").strip().lower() not in ("1", "true", "yes", "on"):
        print(
            "未设置 ALLOW_JOB_INSPECT=1，拒绝执行（防止在未确认环境下误连库）。\n"
            "确认已指向正确的 DB_HOST/REDIS_URL 后：export ALLOW_JOB_INSPECT=1",
            file=sys.stderr,
        )
        return 3

    from app.config import settings
    from app.models import get_job, list_job_events

    host = (settings.db_host or "").strip()
    if host and host not in ("127.0.0.1", "localhost", "::1"):
        print(f"[info] DB_HOST={host}（非本机回环，请确认这是预期环境）", file=sys.stderr)

    row = get_job(jid, user_ref=None)
    if not row:
        print(f"未找到任务: {jid}（或数据库不可达）", file=sys.stderr)
        return 1

    print("=== jobs 行（摘要）===")
    for k in (
        "id",
        "status",
        "job_type",
        "queue_name",
        "progress",
        "project_id",
        "created_by",
        "created_at",
        "updated_at",
        "started_at",
        "completed_at",
        "error_message",
    ):
        if k in row:
            print(f"  {k}: {row.get(k)}")
    payload = row.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    if isinstance(payload, dict):
        print(f"  payload.keys: {list(payload.keys())[:30]}")
        t = str(payload.get("text") or "")
        if t:
            print(f"  payload.text 长度: {len(t)} 字符")

    all_ev: list[dict[str, Any]] = []
    after = 0
    while True:
        chunk = list_job_events(jid, after_id=after)
        if not chunk:
            break
        all_ev.extend(chunk)
        after = int(chunk[-1]["id"])
        if len(all_ev) >= args.events_limit + 200:
            break

    tail = all_ev[-args.events_limit :] if len(all_ev) > args.events_limit else all_ev
    print(f"\n=== job_events（最近 {len(tail)} / 共 {len(all_ev)} 条）===")
    for ev in tail:
        eid = ev.get("id")
        et = ev.get("event_type")
        msg = (ev.get("message") or "")[:120]
        pay = _payload_summary(ev.get("event_payload"))
        ca = ev.get("created_at")
        print(f"  id={eid} type={et} at={ca}")
        print(f"    msg: {msg}")
        print(f"    payload: {pay}")

    rq_id = _find_latest_rq_job_id(all_ev)
    print("\n=== RQ（Redis）===")
    if not rq_id:
        print("  未在事件 payload 中找到 rq_job_id（可能任务创建失败或事件未写入）。")
        return 0

    print(f"  rq_job_id={rq_id}")
    try:
        from redis import Redis
        from rq.job import Job

        conn = Redis.from_url(settings.redis_url)
        job = Job.fetch(rq_id, connection=conn)
        print(f"  RQ status: {job.get_status()}")
        print(f"  RQ origin: {job.origin}")
        print(f"  RQ enqueued_at: {job.enqueued_at}")
        print(f"  RQ started_at: {job.started_at}")
        print(f"  RQ ended_at: {job.ended_at}")
        if job.exc_info:
            ei = str(job.exc_info)[:800]
            print(f"  RQ exc_info: {ei}{'…' if len(str(job.exc_info)) > 800 else ''}")
        if job.result is not None:
            print(f"  RQ result type: {type(job.result).__name__}")
    except Exception as exc:
        print(f"  无法读取 RQ 任务（可能已过期或 ID 无效）: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
