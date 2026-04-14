#!/usr/bin/env python3
"""
将仍处于 queued 且 RQ 中已丢失（Redis 无 rq:job:*）的任务重新入队。

典型原因：Redis 数据过期/清空、Worker 未消费、或切换了 REDIS_URL 导致 DB 与队列不一致。

用法（仓库根目录，需能连同一套 DB 与 Redis）：

  export ALLOW_JOB_INSPECT=1
  export REQUEUE_ORPHAN_JOB=1
  python3 scripts/requeue_job.py 0fd4651b-e8b0-41ab-aa20-3de8a55d6ae4

仅当 jobs.status=queued 且能确认 RQ 中不存在该 rq_job_id 时才会入队；并写入一条 log 事件。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

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


def _find_latest_rq_job_id_from_events(events: list[dict]) -> str | None:
    last: str | None = None
    for ev in events:
        raw = ev.get("event_payload")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        if isinstance(raw, dict) and raw.get("rq_job_id"):
            last = str(raw["rq_job_id"]).strip() or last
    return last


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_id")
    args = parser.parse_args()
    jid = (args.job_id or "").strip()

    _load_env()

    if os.getenv("ALLOW_JOB_INSPECT", "").strip().lower() not in ("1", "true", "yes", "on"):
        print("需要 ALLOW_JOB_INSPECT=1", file=sys.stderr)
        return 3
    if os.getenv("REQUEUE_ORPHAN_JOB", "").strip().lower() not in ("1", "true", "yes", "on"):
        print("需要 REQUEUE_ORPHAN_JOB=1 才会真正入队", file=sys.stderr)
        return 3

    from redis import Redis
    from rq.job import Job

    from app.config import settings
    from app.models import append_job_event, get_job, list_job_events
    from app.queue import ai_queue, media_queue
    from app.worker_tasks import run_ai_job, run_media_job

    row = get_job(jid, user_ref=None)
    if not row:
        print("任务不存在", file=sys.stderr)
        return 1
    st = str(row.get("status") or "")
    if st != "queued":
        print(f"拒绝：当前状态为 {st!r}，仅处理 queued", file=sys.stderr)
        return 2

    qn = str(row.get("queue_name") or "").strip().lower()
    jt = str(row.get("job_type") or "").strip().lower()

    all_ev: list = []
    after = 0
    while True:
        chunk = list_job_events(jid, after_id=after)
        if not chunk:
            break
        all_ev.extend(chunk)
        after = int(chunk[-1]["id"])

    rq_old = _find_latest_rq_job_id_from_events(all_ev)
    conn = Redis.from_url(settings.redis_url)
    if rq_old:
        try:
            j = Job.fetch(rq_old, connection=conn)
            print(f"RQ 仍存在: status={j.get_status()} id={rq_old} — 不重复入队")
            return 0
        except Exception:
            print(f"旧 RQ 任务 {rq_old} 在 Redis 中不存在，将重新入队")

    media_timeout = "20m"

    if qn == "media":
        rq_job = media_queue.enqueue(run_media_job, jid, job_timeout=media_timeout)
    elif qn == "ai":
        rq_job = ai_queue.enqueue(run_ai_job, jid, job_timeout="20m")
    else:
        print(f"未知 queue_name={qn!r}", file=sys.stderr)
        return 2

    append_job_event(
        jid,
        "log",
        "运维/脚本重新入队（原 RQ 任务在 Redis 中缺失或已过期）",
        {"rq_job_id": rq_job.id, "queue": qn},
    )
    print(f"已入队: rq_job_id={rq_job.id} queue={qn} job_type={jt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
