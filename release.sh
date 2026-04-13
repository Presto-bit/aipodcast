#!/usr/bin/env bash
# 服务器快速发布（AI Native / Docker Compose）
#
# 用法：
#   bash release.sh
#
# 可选环境变量：
#   APP_DIR=/opt/FYV   （仓库所在目录；与一键部署的 --root 一致）
#   BRANCH=main
#   REMOTE=origin
#   GIT_PULL=0   跳过 git fetch/pull（离线或固定版本发布）
#   ORCH_HEALTH_MAX_ATTEMPTS=12 ORCH_HEALTH_SLEEP=2   编排器 /health 探测（默认约 24s）
#   WEB_HEALTH_MAX_ATTEMPTS=50 WEB_HEALTH_SLEEP=2      Web :3000 探测（默认约 100s，与 compose web healthcheck start_period 90s 对齐）
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/FYV}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
GIT_PULL="${GIT_PULL:-1}"
COMPOSE_FILE="docker-compose.ai-native.yml"
ENV_FILE=".env.ai-native"

log() { echo "[$(date +'%F %T')] $*"; }
die() { echo "❌ $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose（需 Docker Compose v2 插件）"
command -v curl >/dev/null 2>&1 || die "未找到 curl（健康检查需要）"

[[ -d "$APP_DIR" ]] || die "项目目录不存在: $APP_DIR"
cd "$APP_DIR" || die "无法进入目录: $APP_DIR"

[[ -f "$COMPOSE_FILE" ]] || die "缺少 $COMPOSE_FILE（当前目录：$APP_DIR）"
[[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE，请先复制 .env.ai-native.example 并配置"

log "发布目录: $APP_DIR"
log "远端/分支: $REMOTE/$BRANCH"

if [[ "$GIT_PULL" == "1" ]]; then
  log "拉取最新代码"
  git fetch "$REMOTE" "$BRANCH" || die "git fetch 失败"
  git pull --ff-only "$REMOTE" "$BRANCH" || die "git pull --ff-only 失败（请处理本地变更或合并冲突）"
else
  log "GIT_PULL=0，跳过 git fetch/pull"
fi

log "构建并启动容器"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build || die "docker compose up 失败"

log "健康检查"
ORCH_HEALTH_MAX_ATTEMPTS="${ORCH_HEALTH_MAX_ATTEMPTS:-12}"
ORCH_HEALTH_SLEEP="${ORCH_HEALTH_SLEEP:-2}"
WEB_HEALTH_MAX_ATTEMPTS="${WEB_HEALTH_MAX_ATTEMPTS:-50}"
WEB_HEALTH_SLEEP="${WEB_HEALTH_SLEEP:-2}"

health_ok=0
for ((i = 1; i <= ORCH_HEALTH_MAX_ATTEMPTS; i++)); do
  if curl -fsS --connect-timeout 3 --max-time 10 http://127.0.0.1:8008/health >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  log "编排器 /health 未就绪（第 ${i}/${ORCH_HEALTH_MAX_ATTEMPTS} 次重试）…"
  sleep "$ORCH_HEALTH_SLEEP"
done
[[ "$health_ok" -eq 1 ]] || die "编排器 /health 在多次重试后仍不通"

web_ok=0
for ((i = 1; i <= WEB_HEALTH_MAX_ATTEMPTS; i++)); do
  if curl -fsS --connect-timeout 3 --max-time 15 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    web_ok=1
    break
  fi
  log "Web 3000 未就绪（第 ${i}/${WEB_HEALTH_MAX_ATTEMPTS} 次重试，Next 冷启动可能需 1～2 分钟）…"
  sleep "$WEB_HEALTH_SLEEP"
done
if [[ "$web_ok" -ne 1 ]]; then
  log "Web 仍不可用，最近 web 容器日志（便于排查）："
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail 120 web >&2 || true
  die "Web 3000 在多次重试后仍不通（请检查 web 容器是否 OOM、构建失败或端口被占用；可增大 WEB_HEALTH_MAX_ATTEMPTS）"
fi

log "检查核心容器是否为 running"
for svc in orchestrator web ai-worker media-worker; do
  if [[ -z "$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q --status running "$svc" 2>/dev/null || true)" ]]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -a >&2 || true
    die "容器 $svc 未处于 running，请查看: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs $svc"
  fi
done

log "发布成功"
log "编排器: http://127.0.0.1:8008/health"
log "Web: http://127.0.0.1:3000/"
