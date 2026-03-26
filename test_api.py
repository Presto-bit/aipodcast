#!/usr/bin/env python3
"""
前后端联调：探测后端是否在线 + 核心只读接口（不消耗 MiniMax 配额）。
用法：先启动 Flask（默认 :5001），再执行:
  python3 test_api.py
  或 BASE_URL=http://127.0.0.1:5001 python3 test_api.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = (os.environ.get("BASE_URL") or "http://127.0.0.1:5001").rstrip("/")


def get_json(url: str, timeout: float = 10):
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return resp.status, json.loads(raw) if raw.strip().startswith("{") else {}


def ok(name, cond, detail=""):
    status = "✅" if cond else "❌"
    print(f"{status} {name}" + (f" — {detail}" if detail else ""))
    return cond


def main():
    print(f"联调目标: {BASE}\n")
    results = []

    try:
        req = urllib.request.Request(f"{BASE}/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")[:120]
        results.append(ok("GET /health", status == 200, body))
    except Exception as e:
        results.append(ok("GET /health", False, str(e)))

    try:
        code, j = get_json(f"{BASE}/api/ping", timeout=5)
        results.append(ok("GET /api/ping", code == 200 and j.get("ok") is True, str(j)))
    except Exception as e:
        results.append(ok("GET /api/ping", False, str(e)))

    try:
        code, j = get_json(f"{BASE}/api/default-voices", timeout=10)
        vmap = j.get("voices") or {}
        good = code == 200 and j.get("success") and "mini" in vmap and "max" in vmap
        results.append(ok("GET /api/default-voices", good, f"keys={list(vmap.keys())[:6]}…"))
    except Exception as e:
        results.append(ok("GET /api/default-voices", False, str(e)))

    passed = sum(1 for x in results if x)
    print(f"\n通过 {passed}/{len(results)}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
