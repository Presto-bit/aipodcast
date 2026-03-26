#!/usr/bin/env bash
#==============================================================================
# 阿里云 / Ubuntu 服务器一键部署（需 sudo）
#
# 用法：
#   cd /path/to/minimax_aipodcast
#   sudo bash deploy/one_click_deploy.sh
#
# 非交互（可写入 deploy/deploy.env 后 source，或 export 以下变量）：
#   APP_USER=ubuntu
#   SERVER_NAME=你的域名或公网IP
#   DEPLOY_ROOT=/path/to/minimax_aipodcast
#   INSTALL_APT=1          # 0=跳过 apt 装依赖
#   GIT_PULL=1             # 0=不执行 git pull
#   NODE_MAJOR=20          # NodeSource 主版本
#   BACKEND_ENV_FILE=       # 可选，systemd 注入环境变量文件（如 /etc/default/aipodcast）
#
# 也可用 CLI 传参（非交互）：
#   sudo bash deploy/one_click_deploy.sh --yes \
#     --user ubuntu --server-name 1.2.3.4 --root /opt/minimax_aipodcast
#==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SERVICE_NAME="aipodcast-backend"
NGINX_SITE="aipodcast-backend"
BACKEND_PORT="5001"

# ------------ defaults (override via env or --flags) ------------
APP_USER="${APP_USER:-}"
SERVER_NAME="${SERVER_NAME:-}"
DEPLOY_ROOT="${DEPLOY_ROOT:-$DEFAULT_DEPLOY_ROOT}"
INSTALL_APT="${INSTALL_APT:-}"
GIT_PULL="${GIT_PULL:-}"
NODE_MAJOR="${NODE_MAJOR:-20}"
ASSUME_YES="${ASSUME_YES:-0}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-}"

# ------------ parse CLI ------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    --user) APP_USER="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --root|--deploy-root) DEPLOY_ROOT="$2"; shift 2 ;;
    --no-apt) INSTALL_APT=0; shift ;;
    --with-apt) INSTALL_APT=1; shift ;;
    --no-git-pull) GIT_PULL=0; shift ;;
    --git-pull) GIT_PULL=1; shift ;;
    --node-major) NODE_MAJOR="$2"; shift 2 ;;
    --backend-env-file) BACKEND_ENV_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,25p' "$0"
      exit 0
      ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行，例如: sudo bash $0"
  exit 1
fi

prompt() {
  local def="$2"
  local text="$1"
  local val=""
  if [[ "$ASSUME_YES" == 1 ]]; then
    echo "${def}"
    return
  fi
  read -r -p "${text} [${def}]: " val
  echo "${val:-$def}"
}

if [[ -z "${SUDO_USER:-}" || "$SUDO_USER" == "root" ]]; then
  SUGGEST_USER="$(getent passwd | awk -F: '$3>=1000 && $1!="nobody" {print $1; exit}')"
else
  SUGGEST_USER="$SUDO_USER"
fi

# 自项目目录加载 deploy.env（便于你只改配置文件）
if [[ -f "$DEPLOY_ROOT/deploy/deploy.env" ]]; then
  # shellcheck source=/dev/null
  source "$DEPLOY_ROOT/deploy/deploy.env"
fi

if [[ -z "$APP_USER" ]]; then
  APP_USER="$(prompt "运行后端与前端构建的 Linux 用户名（勿用 root）" "$SUGGEST_USER")"
fi
if [[ -z "$APP_USER" || "$APP_USER" == "root" ]]; then
  echo "APP_USER 不能为 root，请指定普通用户（如 ubuntu、debian）。"
  exit 1
fi
if ! id -u "$APP_USER" &>/dev/null; then
  echo "用户不存在: $APP_USER"
  exit 1
fi

if [[ -z "$SERVER_NAME" ]]; then
  SERVER_NAME="$(prompt "Nginx server_name（域名或公网 IP，多项用空格）" "_")"
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  DEPLOY_ROOT="$(prompt "项目根目录（含 frontend、backend、requirements.txt）" "$DEPLOY_ROOT")"
fi

if [[ ! -f "$DEPLOY_ROOT/requirements.txt" || ! -f "$DEPLOY_ROOT/backend/app.py" ]]; then
  echo "在 $DEPLOY_ROOT 未找到 requirements.txt 或 backend/app.py，请确认 DEPLOY_ROOT。"
  exit 1
fi

if [[ ! -x "$DEPLOY_ROOT" ]]; then
  echo "目录不可访问：$DEPLOY_ROOT"
  echo "请确认目录权限（尤其不要放在 /root 下给普通用户运行）。"
  exit 1
fi

if [[ -z "${INSTALL_APT:-}" ]]; then
  if [[ "$ASSUME_YES" == 1 ]]; then
    INSTALL_APT=1
  else
    yn="$(prompt "是否安装/更新系统依赖（apt: nginx、ffmpeg、python3-venv 等）? (y/n)" "y")"
    [[ "${yn,,}" == y* ]] && INSTALL_APT=1 || INSTALL_APT=0
  fi
fi

if [[ -z "${GIT_PULL:-}" ]]; then
  if [[ "$ASSUME_YES" == 1 ]]; then
    GIT_PULL=1
  else
    yn="$(prompt "若在 git 仓库中，是否执行 git pull? (y/n)" "y")"
    [[ "${yn,,}" == y* ]] && GIT_PULL=1 || GIT_PULL=0
  fi
fi

if [[ "$INSTALL_APT" == 1 ]]; then
  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
  fi
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    echo "当前脚本仅对 Ubuntu/Debian 自动执行 apt。其他发行版请设 INSTALL_APT=0 并手动安装 nginx、ffmpeg、python3-venv、nodejs。"
  else
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git nginx ffmpeg \
      python3 python3-venv python3-pip \
      build-essential pkg-config || true
    # Python 3.12：有则优先包名，无则依赖系统默认 python3
    apt-get install -y -qq python3.12-venv 2>/dev/null || apt-get install -y -qq python3.11-venv 2>/dev/null || true

    if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | tr -d 'v' | cut -d. -f1)" -lt 18 ]]; then
      echo "安装 Node.js ${NODE_MAJOR}.x (NodeSource)..."
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      apt-get install -y -qq nodejs
    fi
  fi
fi

for cmd in nginx python3 node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少命令: $cmd，请先安装或设 INSTALL_APT=1。"
    exit 1
  fi
done

# Git 更新
if [[ "$GIT_PULL" == 1 && -d "$DEPLOY_ROOT/.git" ]]; then
  if ! sudo -u "$APP_USER" -H git -C "$DEPLOY_ROOT" pull --ff-only; then
    echo "（警告）git pull 失败，继续用当前代码。若仓库为公开仓库可考虑改 HTTPS remote，或下次执行 --no-git-pull。"
  fi
fi

# Python：选 3.12 > 3.11 > python3
PYTHON_BIN="python3"
if command -v python3.12 &>/dev/null; then PYTHON_BIN="python3.12"
elif command -v python3.11 &>/dev/null; then PYTHON_BIN="python3.11"
fi
PY_MINOR="$($PYTHON_BIN -c 'import sys; print(sys.version_info.minor)')" || PY_MINOR=0
if [[ "${PY_MINOR:-0}" -ge 13 ]]; then
  echo "需要 Python 3.12 或 3.11（3.13+ 不兼容 audioop）。"
  exit 1
fi

VENV="$DEPLOY_ROOT/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  sudo -u "$APP_USER" -H "$PYTHON_BIN" -m venv "$VENV"
fi
sudo -u "$APP_USER" -H "$VENV/bin/pip" install -q -U pip
sudo -u "$APP_USER" -H "$VENV/bin/pip" install -q -r "$DEPLOY_ROOT/requirements.txt"

# 可写目录（兼容 backend/ 与 backend/backend/ 两种结构）
install -d -o "$APP_USER" -g "$APP_USER" -m 755 \
  "$DEPLOY_ROOT/backend/uploads" \
  "$DEPLOY_ROOT/backend/outputs" \
  "$DEPLOY_ROOT/backend/backend/uploads" \
  "$DEPLOY_ROOT/backend/backend/outputs" || true

# 前端生产构建
sudo -u "$APP_USER" -H bash -c "
  set -e
  cd \"$DEPLOY_ROOT/frontend\"
  printf '%s\n' 'REACT_APP_API_URL=' > .env.production
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
"

# systemd 单元
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
cat >"$UNIT_FILE" <<EOF
[Unit]
Description=MiniMax AI Podcast backend (Flask)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$DEPLOY_ROOT/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python app.py
Restart=on-failure
RestartSec=4
$( [[ -n "$BACKEND_ENV_FILE" ]] && echo "EnvironmentFile=$BACKEND_ENV_FILE" )

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || {
  echo "后端服务启动失败：$SERVICE_NAME"
  systemctl status "$SERVICE_NAME" --no-pager || true
  journalctl -u "$SERVICE_NAME" -n 120 --no-pager || true
  exit 1
}

# Nginx
NGINX_CFG="/etc/nginx/sites-available/${NGINX_SITE}.conf"
cat >"$NGINX_CFG" <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    root $DEPLOY_ROOT/frontend/build;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
    }

    location /download/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }

    location /static/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location = /health {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sf "$NGINX_CFG" "/etc/nginx/sites-enabled/${NGINX_SITE}.conf"
# 禁用 default 站点避免冲突（若存在）
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx

# 健康检查
check_health() {
  local url="$1"
  local i
  for i in {1..20}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! check_health "http://127.0.0.1:${BACKEND_PORT}/api/ping"; then
  echo "后端健康检查失败：http://127.0.0.1:${BACKEND_PORT}/api/ping"
  journalctl -u "$SERVICE_NAME" -n 120 --no-pager || true
  exit 1
fi

if ! check_health "http://127.0.0.1/"; then
  echo "Nginx 健康检查失败：http://127.0.0.1/"
  nginx -t || true
  exit 1
fi

# 防火墙（可选）
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp 2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "部署完成"
echo "  项目目录: $DEPLOY_ROOT"
echo "  后端服务: systemctl status $SERVICE_NAME"
echo "  日志:     journalctl -u $SERVICE_NAME -f"
echo "  Nginx:   $NGINX_CFG"
echo "  浏览器访问: http://${SERVER_NAME// /} （若 server_name 为 _ 则用公网 IP 访问）"
echo "  自检: curl -s http://127.0.0.1:${BACKEND_PORT}/api/ping"
echo "  阿里云安全组需放行: 80/443（SSH 用 22）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
