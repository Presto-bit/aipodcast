#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import sys
import time

import requests


BASE = os.getenv("AI_NATIVE_ORCHESTRATOR", "http://127.0.0.1:8008")
SECRET = os.getenv("INTERNAL_SIGNING_SECRET", "local-internal-secret")


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


def main() -> int:
    payload = {
        "project_name": "smoke-test",
        "job_type": "script_draft",
        "queue_name": "ai",
        "payload": {"text": "请用三句话总结 AI-Native 架构"},
    }
    raw = json.dumps(payload, ensure_ascii=False)
    try:
        r = requests.post(f"{BASE}/api/v1/jobs", data=raw.encode("utf-8"), headers=sign(raw), timeout=20)
        r.raise_for_status()
        job = r.json()
    except requests.RequestException as exc:
        print(f"创建任务失败: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"创建任务响应非 JSON: {exc}", file=sys.stderr)
        return 1

    job_id = job.get("id")
    if not job_id:
        print("创建任务响应缺少 id", file=sys.stderr)
        return 1
    print("created:", job_id)

    terminal_status: str | None = None
    for _ in range(60):
        try:
            rr = requests.get(f"{BASE}/api/v1/jobs/{job_id}", headers=sign("{}"), timeout=10)
            rr.raise_for_status()
            row = rr.json()
        except requests.RequestException as exc:
            print(f"轮询任务失败: {exc}", file=sys.stderr)
            return 1
        except ValueError as exc:
            print(f"轮询响应非 JSON: {exc}", file=sys.stderr)
            return 1
        print("status:", row.get("status"), "progress:", row.get("progress"))
        st = row.get("status")
        if st in ("succeeded", "failed", "cancelled"):
            terminal_status = str(st)
            break
        time.sleep(2)

    if terminal_status is None:
        print("超时：任务未在预期时间内到达终态", file=sys.stderr)
        return 1
    if terminal_status != "succeeded":
        print(f"任务未成功，最终状态: {terminal_status}", file=sys.stderr)
        return 1
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
