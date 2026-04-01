#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from services.orchestrator.app import models  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run payment/user data consistency checks.")
    parser.add_argument("--phone", default="", help="Optional phone filter")
    parser.add_argument("--limit", type=int, default=500, help="Rows to scan (1-1000)")
    parser.add_argument("--strict", action="store_true", help="Exit 1 when issues are found")
    args = parser.parse_args()

    limit = max(1, min(1000, args.limit))
    try:
        report = models.admin_data_consistency_report(phone=args.phone or None, limit=limit)
    except Exception as exc:
        print(f"一致性检查失败: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    if args.strict and int(report.get("issues_count") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
