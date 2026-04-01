from typing import Any

from fastapi import APIRouter

from ..db import get_conn, get_cursor
from ..object_store import object_store_reachable
from ..queue import ai_queue, media_queue, redis_conn

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """就绪检查：PostgreSQL、Redis、队列积压（RQ）。"""
    checks: dict[str, Any] = {"ok": True, "service": "orchestrator"}
    try:
        with get_conn() as conn:
            with get_cursor(conn) as cur:
                cur.execute("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {str(e)[:160]}"
        checks["ok"] = False
    try:
        redis_conn.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {str(e)[:160]}"
        checks["ok"] = False
    try:
        checks["queues"] = {"ai_pending": len(ai_queue), "media_pending": len(media_queue)}
    except Exception as e:
        checks["queues"] = {"error": str(e)[:160]}
        checks["ok"] = False
    os_status = object_store_reachable()
    checks["object_store"] = os_status[:160]
    if os_status != "ok":
        checks["ok"] = False
    return checks
