import os
import sys
import platform
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


def _import_worker_redis():
    here = os.path.dirname(os.path.abspath(__file__))
    if here == "/app":
        redis_dir = "/app"
    else:
        redis_dir = os.path.abspath(os.path.join(here, ".."))
    mod_path = os.path.join(redis_dir, "redis_client.py")
    if not os.path.isfile(mod_path):
        raise ImportError(f"redis_client not found at {mod_path}")
    if redis_dir not in sys.path:
        sys.path.insert(0, redis_dir)
    import redis_client as _rc

    return _rc


def main():
    root = _orch_root()
    if root not in sys.path:
        sys.path.insert(0, root)
    _load_env()
    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    worker_mode = os.getenv("RQ_WORKER_MODE", "auto").lower()
    rc = _import_worker_redis()
    conn = rc.make_worker_redis(redis_url)
    rc.ping_redis_or_exit(conn, role="media-worker")
    prepare = os.getenv("RQ_PREPARE_FOR_WORK", "1").strip().lower() not in ("0", "false", "no", "off")
    with Connection(conn):
        use_simple = worker_mode == "simple" or (worker_mode == "auto" and platform.system() == "Darwin")
        worker_cls = SimpleWorker if use_simple else Worker
        worker = worker_cls([Queue("media", connection=conn)], prepare_for_work=prepare)
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
