"""
在编排器进程内嵌 Redis RQ「ai」队列消费者（SimpleWorker）。

用于本机只跑 uvicorn、未单独起 ai-worker 时，避免 script_draft / podcast_generate 等长期停留在 queued。
生产环境请关闭内嵌（见 Settings.embed_rq_ai_worker），并独立部署 workers/ai-worker。
"""

from __future__ import annotations

import logging
import threading

from redis import Redis
from rq import Connection, Queue
from rq.worker import SimpleWorker

logger = logging.getLogger(__name__)


def start_embedded_ai_rq_worker_thread(redis_url: str) -> threading.Thread:
    """
    启动守护线程消费 ``ai`` 队列；与独立 ``workers/ai-worker`` 行为一致。
    若同时运行独立 ai-worker，二者会竞争拉取任务，属预期（仅略增资源占用）。
    """

    def _run() -> None:
        conn = Redis.from_url(redis_url)
        with Connection(conn):
            worker = SimpleWorker([Queue("ai", connection=conn)])
            worker.work(with_scheduler=False)

    thread = threading.Thread(target=_run, name="rq-ai-embedded", daemon=True)
    thread.start()
    logger.info(
        "embedded RQ SimpleWorker started for queue 'ai' (ORCHESTRATOR_EMBED_RQ_AI_WORKER / non-production default)"
    )
    return thread
