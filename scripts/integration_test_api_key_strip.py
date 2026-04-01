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
        "project_name": "integration-api-key-strip",
        "job_type": "media_render",
        "queue_name": "media",
        "payload": {"text": "hello", "api_key": "should-not-persist"},
    }
    raw = json.dumps(payload, ensure_ascii=False)
    try:
        r = requests.post(f"{BASE}/api/v1/jobs", data=raw.encode("utf-8"), headers=sign(raw), timeout=20)
        r.raise_for_status()
        created = r.json()
        job_id = created.get("id")
        if not job_id:
            print("FAIL: create job response missing id", file=sys.stderr)
            return 1

        rr = requests.get(f"{BASE}/api/v1/jobs/{job_id}", headers=sign("{}"), timeout=10)
        rr.raise_for_status()
        row = rr.json()
    except requests.RequestException as exc:
        print(f"FAIL: HTTP error: {exc}", file=sys.stderr)
        return 1
    except (ValueError, KeyError) as exc:
        print(f"FAIL: invalid JSON response: {exc}", file=sys.stderr)
        return 1
    stored_payload = row.get("payload") or {}
    has_api_key = "api_key" in stored_payload

    if has_api_key:
        print("FAIL: payload.api_key should be stripped but still exists")
        return 1
    print("PASS: payload.api_key stripped from persisted job payload")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
