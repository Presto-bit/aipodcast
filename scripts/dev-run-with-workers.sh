#!/usr/bin/env bash
# 与 make dev / complete-dev 联用：在启动 api+web（concurrently）前启动 ai + media RQ worker，
# 避免播客等媒体任务长期停留在 queued。
#
# Ctrl+C 会结束 api/web，并通过 trap 停止后台 worker。
#
# 仅起 api/web、不跑 worker：SKIP_DEV_WORKERS=1 make dev
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP="${SKIP_DEV_WORKERS:-0}"
WORKER_PIDS=""

cleanup() {
  if [ -n "${WORKER_PIDS}" ]; then
    echo ">>> 停止后台 worker..."
    for pid in ${WORKER_PIDS}; do
      kill "${pid}" >/dev/null 2>&1 || true
    done
  fi
}
trap cleanup EXIT INT TERM

start_worker() {
  local queue="$1"
  local script="${ROOT}/workers/${queue}-worker/worker.py"
  local pybin="${ROOT}/.venv-ai-native/bin/python"
  if [ ! -f "${script}" ]; then
    echo "!!! 缺少 worker 脚本: ${script}" >&2
    exit 1
  fi
  if [ -x "${pybin}" ]; then
    "${pybin}" "${script}" &
  else
    python3 "${script}" &
  fi
  local pid=$!
  WORKER_PIDS="${WORKER_PIDS} ${pid}"
  echo ">>> 已启动 ${queue} worker (pid=${pid})"
}

if [ "${SKIP}" != "1" ]; then
  start_worker "ai"
  start_worker "media"
else
  echo ">>> SKIP_DEV_WORKERS=1：未启动独立 ai/media worker（非生产编排器默认内嵌 RQ 消费两队列；若仍 queued 请查 REDIS_URL 与 /health）"
fi

exec npm run dev
