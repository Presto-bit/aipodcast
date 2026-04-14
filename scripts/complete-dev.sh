#!/usr/bin/env bash
# 可重复重启开发环境：
# - 首次自动安装依赖
# - 重启时自动清理 3000/8008 占用
# - 自动启动 ai/media worker，避免任务长期 queued
# 用法：在仓库根目录执行  bash scripts/complete-dev.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${ORCHESTRATOR_DEV_PORT:-8008}"
WEB_PORT="${NEXT_DEV_PORT:-3000}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
ENV_FILE=".env.ai-native"

kill_port_listeners() {
  local port="$1"
  local pids
  if ! command -v lsof >/dev/null 2>&1; then
    echo ">>> 警告: 未找到 lsof，跳过释放端口 ${port}（若启动失败请手动结束占用进程）" >&2
    return 0
  fi
  pids="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "${pids}" ]; then
    return 0
  fi
  echo ">>> 释放端口 ${port}: ${pids}"
  for pid in ${pids}; do
    kill -TERM "${pid}" >/dev/null 2>&1 || true
  done
  sleep 1
  pids="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    for pid in ${pids}; do
      kill -KILL "${pid}" >/dev/null 2>&1 || true
    done
  fi
}

env_value_from_file() {
  local name="$1"
  local value=""
  if [ ! -f "${ENV_FILE}" ]; then
    echo ""
    return 0
  fi
  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      "${name}="*)
        value="${line#*=}"
        break
        ;;
    esac
  done < "${ENV_FILE}"
  echo "${value}"
}

require_env_var() {
  local name="$1"
  local value
  value="$(env_value_from_file "${name}")"
  if [ -z "${value}" ]; then
    echo "!!! 缺少环境变量: ${name}" >&2
    return 1
  fi
  return 0
}

if [ ! -f .env.ai-native ]; then
  echo ">>> 复制 .env.ai-native.example → .env.ai-native"
  cp .env.ai-native.example .env.ai-native
  echo "!!! 请先编辑 .env.ai-native（如 MINIMAX_API_KEY、DB/Redis 等），然后重新执行本脚本。"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker，请先安装 Docker Desktop。" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker 未运行：请先启动 Docker Desktop，再执行本脚本。" >&2
  exit 1
fi

# 鉴权前置校验：TTS 默认走 minimax；若改用豆包也允许只配豆包
if ! require_env_var MINIMAX_API_KEY; then
  if [ -z "$(env_value_from_file DOUBAO_API_KEY)" ] || [ -z "$(env_value_from_file DOUBAO_TTS_URL)" ]; then
    echo "!!! 语音合成鉴权配置不足。" >&2
    echo "    方案A（默认推荐）：在 .env.ai-native 设置 MINIMAX_API_KEY=你的密钥" >&2
    echo "    方案B（切豆包）：设置 TTS_PROVIDER=doubao 且配置 DOUBAO_API_KEY / DOUBAO_TTS_URL" >&2
    exit 1
  fi
fi

if [ "${SKIP_INSTALL}" != "1" ]; then
  echo ">>> make install-deps（Python venv + pip）"
  make install-deps
  echo ">>> make dev-install（根目录 npm + apps/web npm + concurrently）"
  make dev-install
else
  echo ">>> SKIP_INSTALL=1，跳过依赖安装"
fi

kill_port_listeners "${API_PORT}"
kill_port_listeners "${WEB_PORT}"

echo ">>> 重置基础设施容器（down/up）"
make down || true
make dev-infra

echo ">>> 启动 api + web（含 ai/media worker，见 scripts/dev-run-with-workers.sh）。Ctrl+C 退出时会结束 worker。"
exec bash scripts/dev-run-with-workers.sh
