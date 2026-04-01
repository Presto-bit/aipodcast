#!/usr/bin/env bash
# 一键：释放编排器端口 → 起 Docker 基础服务 → 热重载 api + web，并（macOS）自动打开浏览器
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.ai-native ]; then
  echo "缺少 .env.ai-native，请先: cp .env.ai-native.example .env.ai-native" >&2
  exit 1
fi
if [ ! -f apps/web/package.json ]; then
  echo "请在仓库根目录执行（需存在 apps/web）" >&2
  exit 1
fi
if [ ! -f Makefile ]; then
  echo "缺少根目录 Makefile，无法执行 make dev。" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker 命令，请先安装 Docker Desktop（macOS）或 Docker Engine。" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker 守护进程未运行。请先打开 Docker Desktop（macOS 菜单栏鲸鱼图标就绪），再执行本脚本。" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -ti :8008 >/dev/null 2>&1; then
    echo "释放端口 8008（旧编排器进程）…"
    kill $(lsof -ti :8008) 2>/dev/null || true
    sleep 1
  fi
fi

WEB_URL="${WEB_DEV_URL:-http://localhost:3000}"
echo "即将启动: Docker(PG/Redis/MinIO) + 编排器 :8008 + Next 前端"
echo "浏览器地址: ${WEB_URL}"
echo ""

if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
  (sleep 8 && open "${WEB_URL}") &
fi

exec make dev
