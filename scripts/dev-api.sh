#!/usr/bin/env bash
# 编排器热重载：优先使用仓库根目录 .venv-ai-native（与 make install-deps 一致）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ORCHESTRATOR_DEV_PORT:-8008}"

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "dev-api: 端口 ${PORT} 已被占用（常见：上次 uvicorn 未退出）。请先结束占用进程，例如：" >&2
    echo "  lsof -nP -iTCP:${PORT} -sTCP:LISTEN" >&2
    echo "  kill \$(lsof -ti :${PORT})" >&2
    echo "或设置其它端口: ORCHESTRATOR_DEV_PORT=8009 bash scripts/dev-api.sh（并同步 .env 中 ORCHESTRATOR_URL）" >&2
    exit 1
  fi
fi

if [[ ! -d "$ROOT/services/orchestrator" ]]; then
  echo "dev-api: 未找到 $ROOT/services/orchestrator" >&2
  exit 1
fi
cd "$ROOT/services/orchestrator" || exit 1
PY="$ROOT/.venv-ai-native/bin/python"
if [ -x "$PY" ]; then
  exec "$PY" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
fi
if ! python3 -c "import uvicorn" 2>/dev/null; then
  echo "dev-api: 当前 python3 未安装 uvicorn，且未找到 $ROOT/.venv-ai-native" >&2
  echo "请在本仓库根目录执行:  make install-deps   或   make dev-install" >&2
  exit 1
fi
exec python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
