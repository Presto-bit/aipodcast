#!/usr/bin/env bash
# 服务器快速发布脚本（阿里云 ECS）
# 用法：
#   bash release.sh
# 可选环境变量：
#   APP_DIR=/opt/aipodcast
#   BRANCH=main
#   DEPLOY_USER=presto
#   USE_ENV_FILE=1
#   ENV_FILE=/etc/default/aipodcast
#   SKIP_APT=1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aipodcast}"
BRANCH="${BRANCH:-main}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-$(whoami)}}"
USE_ENV_FILE="${USE_ENV_FILE:-1}"
ENV_FILE="${ENV_FILE:-/etc/default/aipodcast}"
SKIP_APT="${SKIP_APT:-1}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "❌ 项目目录不存在: $APP_DIR"
  exit 1
fi

echo "==> 发布目录: $APP_DIR"
echo "==> 分支: $BRANCH"
echo "==> 部署用户: $DEPLOY_USER"

cd "$APP_DIR"

echo "==> 拉取最新代码"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> 执行一键部署"
DEPLOY_CMD=(sudo bash deploy.sh --yes)
if [[ "$SKIP_APT" == "1" ]]; then
  DEPLOY_CMD+=(--no-apt)
fi
if [[ "$USE_ENV_FILE" == "1" ]]; then
  DEPLOY_CMD+=(--backend-env-file "$ENV_FILE")
fi
"${DEPLOY_CMD[@]}"

echo "==> 服务状态检查"
systemctl is-active --quiet aipodcast-backend || {
  echo "❌ aipodcast-backend 未运行"
  systemctl status aipodcast-backend --no-pager || true
  journalctl -u aipodcast-backend -n 120 --no-pager || true
  exit 1
}

echo "==> 健康检查"
curl -fsS http://127.0.0.1:5001/api/ping >/dev/null
curl -fsS http://127.0.0.1/ >/dev/null

echo "✅ 发布成功"
echo "   - 后端: http://127.0.0.1:5001"
echo "   - 前端: http://$(hostname -I | awk '{print $1}')"
