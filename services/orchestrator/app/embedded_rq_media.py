"""
在编排器进程内嵌 Redis RQ「media」队列消费者（SimpleWorker）。

用于本机只跑 uvicorn、未单独起 media-worker 时，避免 podcast_generate 长期停留在 queued。
生产环境请关闭内嵌（见 Settings.embed_rq_media_worker），并独立部署 workers/media-worker。
"""

from __future__ import annotations

import logging
import threading

from redis import Redis
from rq import Connection, Queue
from rq.worker import SimpleWorker

logger = logging.getLogger(__name__)


def start_embedded_media_rq_worker_thread(redis_url: str) -> threading.Thread:
    """
    启动守护线程消费 ``media`` 队列；与独立 ``workers/media-worker`` 行为一致。
    若同时运行独立 media-worker，二者会竞争拉取任务，属预期（仅略增资源占用）。
    """

    def _run() -> None:
        conn = Redis.from_url(redis_url)
        with Connection(conn):
            worker = SimpleWorker([Queue("media", connection=conn)])
            worker.work(with_scheduler=False)

    thread = threading.Thread(target=_run, name="rq-media-embedded", daemon=True)
    thread.start()
    logger.info("embedded RQ SimpleWorker started for queue 'media' (ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER / non-production default)")
    return thread
