import os
import sys
import platform
from redis import Redis
from rq import Connection, Queue, Worker
from rq.worker import SimpleWorker
from dotenv import load_dotenv


def _orch_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    if here == "/app":
        return "/app/services/orchestrator"
    return os.path.abspath(os.path.join(here, "..", "..", "services", "orchestrator"))


def _load_env() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    repo = "/app" if here == "/app" else os.path.abspath(os.path.join(here, "..", ".."))
    load_dotenv(os.path.join(repo, ".env.ai-native"), override=False)
    load_dotenv(".env.ai-native", override=False)


def main():
    root = _orch_root()
    if root not in sys.path:
        sys.path.insert(0, root)
    _load_env()
    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    worker_mode = os.getenv("RQ_WORKER_MODE", "auto").lower()
    conn = Redis.from_url(redis_url)
    with Connection(conn):
        use_simple = worker_mode == "simple" or (worker_mode == "auto" and platform.system() == "Darwin")
        worker_cls = SimpleWorker if use_simple else Worker
        worker = worker_cls([Queue("media", connection=conn)])
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
