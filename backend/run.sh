#!/usr/bin/env bash
# 在项目根目录已创建 .venv 的前提下，启动 Flask（监听 0.0.0.0:5001）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "❌ 未找到虚拟环境: $PY"
  echo "请在项目根目录 minimax_aipodcast 执行："
  echo "  python3.12 -m venv .venv   # 或 python3.11"
  echo "  source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  exit 1
fi
cd "$ROOT/backend"
export RAG_EMBEDDING_PROVIDER="${RAG_EMBEDDING_PROVIDER:-api}"
export RAG_EMBEDDING_API_URL="${RAG_EMBEDDING_API_URL:-https://api.minimaxi.com/v1/embeddings}"
export RAG_EMBEDDING_MODEL="${RAG_EMBEDDING_MODEL:-embo-01}"
exec "$PY" app.py
