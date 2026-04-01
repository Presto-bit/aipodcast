#!/usr/bin/env bash
#==============================================================================
# AI Native：Docker Compose 一键部署（需 sudo，用于安装 Docker 与拉起栈）
#
# 用法：
#   cd /path/to/minimax_aipodcast
#   sudo bash deploy/one_click_deploy.sh
#
# 非交互（可写入 deploy/deploy.env 后 source，或 export 以下变量）：
#   APP_USER=ubuntu
#   DEPLOY_ROOT=/path/to/minimax_aipodcast
#   INSTALL_APT=1          # 0=跳过 apt 安装 docker.io
#   GIT_PULL=1             # 0=不执行 git pull
#
#   sudo bash deploy/one_click_deploy.sh --yes \
#     --user ubuntu --root /opt/minimax_aipodcast
#==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_USER="${APP_USER:-}"
DEPLOY_ROOT="${DEPLOY_ROOT:-$DEFAULT_DEPLOY_ROOT}"
INSTALL_APT="${INSTALL_APT:-}"
GIT_PULL="${GIT_PULL:-}"
ASSUME_YES="${ASSUME_YES:-0}"
COMPOSE_FILE="docker-compose.ai-native.yml"
ENV_FILE=".env.ai-native"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    --user) APP_USER="$2"; shift 2 ;;
    --root|--deploy-root) DEPLOY_ROOT="$2"; shift 2 ;;
    --no-apt) INSTALL_APT=0; shift ;;
    --with-apt) INSTALL_APT=1; shift ;;
    --no-git-pull) GIT_PULL=0; shift ;;
    --git-pull) GIT_PULL=1; shift ;;
    -h|--help)
      sed -n '1,22p' "$0"
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

if [[ -f "$DEPLOY_ROOT/deploy/deploy.env" ]]; then
  # shellcheck source=/dev/null
  source "$DEPLOY_ROOT/deploy/deploy.env"
fi

if [[ -z "$APP_USER" ]]; then
  APP_USER="$(prompt "运行 Docker 的 Linux 用户名（勿用 root）" "$SUGGEST_USER")"
fi
if [[ -z "$APP_USER" || "$APP_USER" == "root" ]]; then
  echo "APP_USER 不能为 root，请指定普通用户（如 ubuntu、debian）。"
  exit 1
fi
if ! id -u "$APP_USER" &>/dev/null; then
  echo "用户不存在: $APP_USER"
  exit 1
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  DEPLOY_ROOT="$(prompt "项目根目录（含 docker-compose.ai-native.yml）" "$DEPLOY_ROOT")"
fi

if [[ ! -d "$DEPLOY_ROOT" ]]; then
  echo "DEPLOY_ROOT 不是有效目录: $DEPLOY_ROOT"
  exit 1
fi
if [[ ! -f "$DEPLOY_ROOT/$COMPOSE_FILE" ]]; then
  echo "在 $DEPLOY_ROOT 未找到 $COMPOSE_FILE，请确认 DEPLOY_ROOT。"
  exit 1
fi

if [[ ! -f "$DEPLOY_ROOT/$ENV_FILE" ]]; then
  if [[ -f "$DEPLOY_ROOT/.env.ai-native.example" ]]; then
    echo "复制 $ENV_FILE 自 .env.ai-native.example，请编辑后再部署。"
    sudo -u "$APP_USER" -H cp "$DEPLOY_ROOT/.env.ai-native.example" "$DEPLOY_ROOT/$ENV_FILE"
  else
    echo "缺少 $DEPLOY_ROOT/$ENV_FILE，请先创建（可参考 .env.ai-native.example）。"
    exit 1
  fi
fi

if [[ -z "${INSTALL_APT:-}" ]]; then
  if [[ "$ASSUME_YES" == 1 ]]; then
    INSTALL_APT=1
  else
    yn="$(prompt "是否安装/更新 Docker（apt: docker.io）? (y/n)" "y")"
    [[ "${yn,,}" == y* ]] && INSTALL_APT=1 || INSTALL_APT=0
  fi
fi

if [[ "$INSTALL_APT" == 1 ]]; then
  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
  fi
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    echo "当前脚本仅对 Ubuntu/Debian 自动执行 apt。其他发行版请设 INSTALL_APT=0 并手动安装 Docker。"
  else
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || { echo "apt-get update 失败"; exit 1; }
    apt-get install -y -qq ca-certificates curl git docker.io docker-compose-plugin || {
      echo "apt 安装 Docker 相关包失败，请检查网络与软件源后重试，或设 INSTALL_APT=0 并手动安装 Docker。"
      exit 1
    }
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker，请先安装 Docker 或设 INSTALL_APT=1。"
  exit 1
fi

if [[ -z "${GIT_PULL:-}" ]]; then
  if [[ "$ASSUME_YES" == 1 ]]; then
    GIT_PULL=1
  else
    yn="$(prompt "若在 git 仓库中，是否执行 git pull? (y/n)" "y")"
    [[ "${yn,,}" == y* ]] && GIT_PULL=1 || GIT_PULL=0
  fi
fi

if [[ "$GIT_PULL" == 1 && -d "$DEPLOY_ROOT/.git" ]]; then
  if ! sudo -u "$APP_USER" -H git -C "$DEPLOY_ROOT" pull --ff-only; then
    echo "（警告）git pull 失败，继续用当前代码。"
  fi
fi

# 将运行用户加入 docker 组（若存在）
if getent group docker >/dev/null 2>&1; then
  usermod -aG docker "$APP_USER" 2>/dev/null || true
fi

sudo -u "$APP_USER" -H bash -c "
  set -e
  cd \"$DEPLOY_ROOT\"
  docker compose -f \"$COMPOSE_FILE\" --env-file \"$ENV_FILE\" up -d --build
"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "部署完成（Docker Compose）"
echo "  项目目录: $DEPLOY_ROOT"
echo "  Web:      http://127.0.0.1:3000"
echo "  编排器:   curl -s http://127.0.0.1:8008/health"
echo "  日志:     cd $DEPLOY_ROOT && sudo -u $APP_USER docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f --tail=200"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
