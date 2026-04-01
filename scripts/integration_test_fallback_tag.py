#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests


BASE = os.getenv("AI_NATIVE_ORCHESTRATOR", "http://127.0.0.1:8008")
SECRET = os.getenv("INTERNAL_SIGNING_SECRET", "local-internal-secret")
ROOT = Path(__file__).resolve().parents[1]


def sign(payload: str) -> dict[str, str]:
    ts = str(int(time.time() * 1000))
    sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    sig = hmac.new(SECRET.encode("utf-8"), f"{ts}:{sha}".encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "x-internal-timestamp": ts,
        "x-internal-payload-sha256": sha,
        "x-internal-signature": sig,
        "content-type": "application/json",
    }


def run_one_shot_ai_worker() -> None:
    python = ROOT / ".venv-ai-native" / "bin" / "python"
    if not python.is_file():
        raise FileNotFoundError(f"未找到 {python}，请先 make install-deps")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT / "services" / "orchestrator")
    env["AI_NATIVE_FORCE_FALLBACK"] = "1"
    code = """
from redis import Redis
from rq import Queue, Connection
from rq.worker import SimpleWorker
conn = Redis.from_url('redis://127.0.0.1:6379/0')
with Connection(conn):
    w = SimpleWorker([Queue('ai', connection=conn)])
    w.work(burst=True, with_scheduler=False)
"""
    subprocess.run([str(python), "-c", code], env=env, check=True, cwd=str(ROOT))


def main() -> int:
    if not (ROOT / "services" / "orchestrator").is_dir():
        print("FAIL: 请在仓库根目录运行（缺少 services/orchestrator）", file=sys.stderr)
        return 1
    payload = {
        "project_name": "integration-fallback-tag",
        "job_type": "script_draft",
        "queue_name": "ai",
        "payload": {
            "text": "请总结 fallback 行为",
            "integration_force_fallback": True,
        },
    }
    raw = json.dumps(payload, ensure_ascii=False)
    try:
        r = requests.post(f"{BASE}/api/v1/jobs", data=raw.encode("utf-8"), headers=sign(raw), timeout=20)
        r.raise_for_status()
        body = r.json()
        job_id = body.get("id")
        if not job_id:
            print("FAIL: create job response missing id", file=sys.stderr)
            return 1
    except requests.RequestException as exc:
        print(f"FAIL: HTTP error: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"FAIL: invalid JSON: {exc}", file=sys.stderr)
        return 1

    try:
        run_one_shot_ai_worker()
    except FileNotFoundError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"FAIL: worker subprocess failed: {exc}", file=sys.stderr)
        return 1

    terminal = None
    for _ in range(20):
        try:
            rr = requests.get(f"{BASE}/api/v1/jobs/{job_id}", headers=sign("{}"), timeout=10)
            rr.raise_for_status()
            row = rr.json()
        except (requests.RequestException, ValueError) as exc:
            print(f"FAIL: poll job error: {exc}", file=sys.stderr)
            return 1
        if row.get("status") in ("succeeded", "failed", "cancelled"):
            terminal = row
            break
        time.sleep(1)

    if not terminal:
        print("FAIL: job did not reach terminal status")
        return 1
    if terminal.get("status") != "succeeded":
        print(f"FAIL: expected succeeded, got {terminal.get('status')}")
        return 1
    result = terminal.get("result") or {}
    if result.get("fallback") is not True:
        print("FAIL: expected result.fallback=true")
        return 1
    print("PASS: fallback tag is set in job result")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
