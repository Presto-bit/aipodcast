#!/usr/bin/env python3
"""部署前配置自检（生产 FYV_PRODUCTION=1 时常用）。"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
ORCH_DIR = ROOT / "services" / "orchestrator"
if str(ORCH_DIR) not in sys.path:
    sys.path.insert(0, str(ORCH_DIR))

from app.config import settings  # noqa: E402


def _production() -> bool:
    return (os.environ.get("FYV_PRODUCTION") or "").strip().lower() in ("1", "true", "yes", "on")


def main() -> int:
    errors: list[str] = []
    if _production():
        if settings.embed_rq_media_worker or settings.embed_rq_ai_worker:
            errors.append("生产环境须 ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER=0 且 ORCHESTRATOR_EMBED_RQ_AI_WORKER=0")
        presign = (settings.object_presign_endpoint or "").strip()
        if not presign:
            errors.append("生产环境须设置 OBJECT_PRESIGN_ENDPOINT=https://…")
        elif (urlparse(presign).scheme or "").lower() != "https":
            errors.append("OBJECT_PRESIGN_ENDPOINT 须为 https://")
    if errors:
        for e in errors:
            print(f"[check_config] {e}", file=sys.stderr)
        return 1
    print("[check_config] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
