from typing import Any

from fastapi import APIRouter

from ..db import get_conn, get_cursor
from ..object_store import object_store_reachable
from ..queue import ai_queue, media_queue, redis_conn

try:
    from rq import Worker as RqWorker
except ImportError:  # pragma: no cover - 编排器依赖 rq，仅极端裁剪镜像时触发
    RqWorker = None  # type: ignore[misc, assignment]

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
    try:
        from ..config import settings as _settings

        checks["embedded_media_rq_worker"] = bool(getattr(_settings, "embed_rq_media_worker", False))
    except Exception:
        pass
    if RqWorker is not None:
        try:
            m_workers = int(RqWorker.count(connection=redis_conn, queue=media_queue))
            a_workers = int(RqWorker.count(connection=redis_conn, queue=ai_queue))
            checks["rq_workers"] = {"media": m_workers, "ai": a_workers}
            qd = checks.get("queues")
            embed_m = bool(checks.get("embedded_media_rq_worker", False))
            if isinstance(qd, dict) and "error" not in qd:
                media_pending = int(qd.get("media_pending", 0))
                ai_pending = int(qd.get("ai_pending", 0))
                alerts: list[str] = []
                if media_pending > 0 and m_workers == 0:
                    if embed_m:
                        alerts.append(
                            "media 队列有等待任务但 RQ 未登记 media worker（进程内嵌消费线程可能未启动）；"
                            "请查编排器启动日志；也可单独运行 workers/media-worker。"
                        )
                    else:
                        alerts.append(
                            "media 队列有等待任务但未发现消费 media 的 RQ worker，播客等任务会一直排队。"
                            "请运行 workers/media-worker 并与编排器共用 REDIS_URL；"
                            "或单机设 ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER=1（生产通常关闭并独立扩容 worker）。"
                        )
                if ai_pending > 0 and a_workers == 0:
                    alerts.append(
                        "ai 队列有等待任务但未发现消费 ai 的 RQ worker，脚本/索引等会排队。"
                        "请运行 workers/ai-worker；本地请用 make dev（勿仅用 SKIP_DEV_WORKERS=1）。"
                    )
                if alerts:
                    checks["queue_alerts"] = alerts
        except Exception as e:
            checks["rq_workers"] = {"error": str(e)[:160]}
    os_status = object_store_reachable()
    checks["object_store"] = os_status[:160]
    if os_status != "ok":
        checks["ok"] = False
    return checks
