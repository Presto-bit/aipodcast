#!/usr/bin/env python3
"""
开发专用：监听编排器与 Worker 目录下的代码变更，自动终止并重启 RQ Worker。

注意：重启会中断当前正在执行的任务；仅用于本地开发，勿用于生产。
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _python_cmd() -> list[str]:
    venv = ROOT / ".venv-ai-native" / "bin" / "python"
    if venv.is_file():
        return [str(venv)]
    return [sys.executable]


def _worker_script(which: str) -> Path:
    if which == "ai":
        return ROOT / "workers" / "ai-worker" / "worker.py"
    if which == "media":
        return ROOT / "workers" / "media-worker" / "worker.py"
    raise SystemExit("worker 必须是 ai 或 media")


def _watch_paths() -> list[Path]:
    return [
        ROOT / "services" / "orchestrator" / "app",
        ROOT / "workers" / "ai-worker",
        ROOT / "workers" / "media-worker",
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="RQ Worker 文件变更热重载（仅开发）。")
    parser.add_argument("worker", choices=("ai", "media"), help="ai-worker 或 media-worker")
    args = parser.parse_args()
    os.chdir(ROOT)

    try:
        from watchfiles import watch
    except ImportError as exc:
        print("缺少 watchfiles：请在仓库根目录执行 make install-deps", file=sys.stderr)
        raise SystemExit(1) from exc

    cmd = [*_python_cmd(), str(_worker_script(args.worker))]
    proc: subprocess.Popen[bytes] | None = None

    def terminate() -> None:
        nonlocal proc
        if proc is None or proc.poll() is not None:
            proc = None
            return
        proc.send_signal(signal.SIGTERM)
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                break
            time.sleep(0.1)
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
        proc = None

    def start() -> None:
        nonlocal proc
        terminate()
        proc = subprocess.Popen(cmd, cwd=str(ROOT))
        print(f"dev-worker-watch: started pid={proc.pid} cmd={' '.join(cmd)}", flush=True)

    start()
    try:
        for _changes in watch(
            *_watch_paths(),
            debounce=800,
            step=100,
            raise_interrupt=False,
        ):
            print("dev-worker-watch: 检测到变更，正在重启 Worker…", flush=True)
            start()
    except KeyboardInterrupt:
        print("dev-worker-watch: 已退出", flush=True)
    finally:
        terminate()


if __name__ == "__main__":
    main()
