import argparse
import os
import platform
import signal
import subprocess
import sys
import time
from rq import Connection, Queue, Worker
from rq.worker import SimpleWorker
from dotenv import load_dotenv

# 单容器内并行消费 ai 队列的 worker 进程数上限（由 RQ_AI_WORKER_PROCESSES 控制，默认 1）
_MAX_AI_WORKER_PROCESSES = 32


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


def _parse_process_count() -> int:
    raw = (os.getenv("RQ_AI_WORKER_PROCESSES") or "1").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 1
    return max(1, min(_MAX_AI_WORKER_PROCESSES, n))


def _log(msg: str) -> None:
    print(f"[ai-worker] {msg}", flush=True)


def run_single_worker(*, child_index: int | None = None) -> None:
    root = _orch_root()
    if root not in sys.path:
        sys.path.insert(0, root)
    _load_env()
    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    worker_mode = os.getenv("RQ_WORKER_MODE", "auto").lower()
    rc = _import_worker_redis()
    conn = rc.make_worker_redis(redis_url)
    role = "ai-worker" if child_index is None else f"ai-worker-{child_index}"
    rc.ping_redis_or_exit(conn, role=role)
    prepare = os.getenv("RQ_PREPARE_FOR_WORK", "1").strip().lower() not in ("0", "false", "no", "off")
    with Connection(conn):
        use_simple = worker_mode == "simple" or (worker_mode == "auto" and platform.system() == "Darwin")
        worker_cls = SimpleWorker if use_simple else Worker
        worker = worker_cls([Queue("ai", connection=conn)], prepare_for_work=prepare)
        if child_index is not None:
            _log(f"child {child_index} started (pid={os.getpid()})")
        worker.work(with_scheduler=False)


def _supervisor(process_count: int) -> None:
    script = os.path.abspath(__file__)
    python = sys.executable
    children: list[subprocess.Popen[bytes]] = []
    shutting_down = False

    def spawn(index: int) -> subprocess.Popen[bytes]:
        env = {**os.environ, "RQ_AI_WORKER_CHILD": "1", "RQ_AI_WORKER_CHILD_INDEX": str(index)}
        return subprocess.Popen([python, script, "--child"], env=env)

    def terminate_all() -> None:
        for proc in children:
            if proc.poll() is None:
                proc.terminate()
        deadline = time.time() + 25.0
        for proc in children:
            while proc.poll() is None and time.time() < deadline:
                time.sleep(0.2)
        for proc in children:
            if proc.poll() is None:
                proc.kill()

    def handle_signal(signum: int, _frame) -> None:
        nonlocal shutting_down
        if shutting_down:
            return
        shutting_down = True
        _log(f"supervisor received signal {signum}, stopping {len(children)} worker(s)")

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    _log(f"supervisor starting {process_count} RQ consumer(s) (RQ_AI_WORKER_PROCESSES={process_count})")
    for idx in range(1, process_count + 1):
        children.append(spawn(idx))

    while not shutting_down:
        for i, proc in enumerate(children):
            if proc.poll() is not None:
                _log(f"worker child {i + 1} exited (code={proc.returncode}), restarting")
                children[i] = spawn(i + 1)
        time.sleep(2.0)

    terminate_all()


def main() -> None:
    _load_env()
    parser = argparse.ArgumentParser(description="RQ ai queue worker")
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.child or os.getenv("RQ_AI_WORKER_CHILD", "").strip().lower() in ("1", "true", "yes", "on"):
        idx_raw = (os.getenv("RQ_AI_WORKER_CHILD_INDEX") or "").strip()
        child_index = int(idx_raw) if idx_raw.isdigit() else None
        run_single_worker(child_index=child_index)
        return

    process_count = _parse_process_count()
    if process_count == 1:
        run_single_worker()
    else:
        _supervisor(process_count)


if __name__ == "__main__":
    main()
