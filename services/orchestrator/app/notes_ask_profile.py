"""知识库问答耗时诊断：设置 NOTES_ASK_PROFILE=1 后打结构化日志（勿在生产长期开启）。"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def notes_ask_profile_enabled() -> bool:
    v = (os.getenv("NOTES_ASK_PROFILE") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def notes_ask_profile_emit(phase: str, elapsed_ms: float, **fields: Any) -> None:
    if not notes_ask_profile_enabled():
        return
    payload: dict[str, Any] = {
        "event": "notes_ask_profile",
        "phase": phase,
        "elapsed_ms": round(float(elapsed_ms), 3),
    }
    for k, v in fields.items():
        if v is not None:
            payload[k] = v
    logger.info("%s", json.dumps(payload, ensure_ascii=False))
