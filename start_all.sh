#!/bin/bash

echo "======================================"
echo "  🎙️ AI播客生成器"
echo "======================================"
echo ""

set -euo pipefail

# 项目根目录
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# 网络稳态：避免系统代理影响 MiniMax API（可按需自行注释）
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="localhost,127.0.0.1,api.minimaxi.com,api.minimax.chat"
export no_proxy="$NO_PROXY"

# 选择 Python：优先 3.12（含 audioop），其次 3.11
PYTHON_BIN=""
if command -v python3.12 &> /dev/null; then
  PYTHON_BIN="python3.12"
elif command -v python3.11 &> /dev/null; then
  PYTHON_BIN="python3.11"
elif command -v python3 &> /dev/null; then
  PYTHON_BIN="python3"
else
  echo "❌ 未找到 Python，请先安装 Python 3.12（推荐）或 3.11"
  exit 1
fi

PY_VER="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
PY_MINOR="$("$PYTHON_BIN" -c 'import sys; print(sys.version_info.minor)')"
if [ "$PY_MINOR" -ge 13 ]; then
  echo "❌ 检测到 Python $PY_VER（>=3.13）。本项目依赖的音频处理需要 audioop，而 audioop 在 Python 3.13+ 已移除。"
  echo "✅ 请安装 Python 3.12（推荐）或 3.11，然后重新运行本脚本。"
  exit 1
fi

echo "🐍 使用 Python: $PYTHON_BIN ($PY_VER)"

# 虚拟环境路径
VENV_DIR="$ROOT_DIR/.venv"

# 如果现有 venv 的 Python 版本不匹配，重建 venv
if [ -x "$VENV_DIR/bin/python" ]; then
  VENV_VER="$("$VENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' || echo "")"
  if [ -n "$VENV_VER" ] && [ "$VENV_VER" != "$PY_VER" ]; then
    echo "🔄 检测到现有 .venv 使用 Python $VENV_VER，与当前选择的 $PY_VER 不一致，正在重建 .venv..."
    rm -rf "$VENV_DIR"
  fi
fi

# 准备后端虚拟环境并安装依赖（规避 macOS PEP 668）
echo "📦 正在准备 Python 虚拟环境..."
if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "📦 正在安装后端依赖..."
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt

# 启动后端
echo ""
echo "🚀 启动后端服务 (Flask - Port 5001)..."
cd "$ROOT_DIR/backend"
python app.py &
BACKEND_PID=$!
echo "后端 PID: $BACKEND_PID"

# 等待后端启动
sleep 3

# 启动前端
echo ""
echo "🚀 启动前端服务 (React - Port 3000)..."
cd "$ROOT_DIR/frontend"

# 安装前端依赖（如果需要）
if [ ! -d "node_modules" ]; then
  echo "📦 安装前端依赖..."
  npm install
fi

npm start &
FRONTEND_PID=$!
echo "前端 PID: $FRONTEND_PID"

echo ""
echo "======================================"
echo "✅ 服务启动完成！"
echo ""
echo "后端地址: http://localhost:5001"
echo "前端地址: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo "======================================"

# 等待用户中断
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true; exit" INT
wait
