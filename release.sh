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
#   NEXT_PUBLIC_APP_VERSION=自定义   写入前端构建号；不设则发版脚本默认用当前目录 git 短 SHA
#   NEXT_PUBLIC_APP_BUILD_ID=整数   可选；不设则发版脚本用 git rev-list --count HEAD（单调递增，用于软刷新/旧包检测）
#   COMPOSE_BUILD_PULL=0|1   发版时 docker compose build 是否加 --pull（默认 1，刷新各 Dockerfile 的 FROM）
#   DOCKER_BUILD_NO_CACHE=1   构建禁用层缓存（极慢，仅排障）
#   阿里云 CDN：在 .env.ai-native 配置 ALIYUN_CDN_REFRESH_ON_RELEASE=1 等（见该文件注释）；发版成功后会调用 scripts/aliyun-cdn-refresh.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/FYV}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
GIT_PULL="${GIT_PULL:-1}"
COMPOSE_FILE="docker-compose.ai-native.yml"
ENV_FILE=".env.ai-native"

log() { echo "[$(date +'%F %T')] $*"; }
die() { echo "❌ $*" >&2; exit 1; }

# 从 .env 读 KEY=value（跳过注释；同一 key 多次出现时取最后一次）；仅用于 shell 未预先 export 的变量
read_key_from_env_file() {
  local file="$1" want="$2" out=""
  [[ -f "$file" ]] || return 0
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="${raw%%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*${want}=(.*)$ ]] || continue
    local v="${BASH_REMATCH[1]}"
    v="${v#"${v%%[![:space:]]*}"}"
    v="${v%"${v##*[![:space:]]}"}"
    v="${v#\"}"; v="${v%\"}"
    v="${v#\'}"; v="${v%\'}"
    out="$v"
  done <"$file"
  [[ -n "$out" ]] && printf '%s' "$out"
}

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

# NEXT_PUBLIC_APP_VERSION：已 export 则沿用；否则读 .env.ai-native；仍空则用 git 短 SHA（打进 Web 镜像）
if [[ -z "${NEXT_PUBLIC_APP_VERSION:-}" && -f "$ENV_FILE" ]]; then
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="${raw%%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*NEXT_PUBLIC_APP_VERSION=(.*)$ ]] || continue
    v="${BASH_REMATCH[1]}"
    v="${v#"${v%%[![:space:]]*}"}"
    v="${v%"${v##*[![:space:]]}"}"
    v="${v#\"}"; v="${v%\"}"
    v="${v#\'}"; v="${v%\'}"
    NEXT_PUBLIC_APP_VERSION="$v"
  done <"$ENV_FILE"
fi
if [[ -z "${NEXT_PUBLIC_APP_VERSION:-}" ]]; then
  NEXT_PUBLIC_APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
fi
export NEXT_PUBLIC_APP_VERSION
log "Web 构建版本号 NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}"

# 单调递增构建号：供前端 DeployVersionSync 识别「软刷新命中旧包」时勿把 localStorage 降回旧版本（见组件注释）
if [[ -z "${NEXT_PUBLIC_APP_BUILD_ID:-}" && -f "$ENV_FILE" ]]; then
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="${raw%%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*NEXT_PUBLIC_APP_BUILD_ID=(.*)$ ]] || continue
    v="${BASH_REMATCH[1]}"
    v="${v#"${v%%[![:space:]]*}"}"
    v="${v%"${v##*[![:space:]]}"}"
    v="${v#\"}"; v="${v%\"}"
    v="${v#\'}"; v="${v%\'}"
    NEXT_PUBLIC_APP_BUILD_ID="$v"
  done <"$ENV_FILE"
fi
if [[ -z "${NEXT_PUBLIC_APP_BUILD_ID:-}" ]]; then
  NEXT_PUBLIC_APP_BUILD_ID="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
fi
export NEXT_PUBLIC_APP_BUILD_ID
log "Web 构建序号 NEXT_PUBLIC_APP_BUILD_ID=${NEXT_PUBLIC_APP_BUILD_ID}"

if [[ -z "${COMPOSE_BUILD_PULL:-}" ]]; then
  v="$(read_key_from_env_file "$ENV_FILE" COMPOSE_BUILD_PULL)"
  [[ -n "$v" ]] && COMPOSE_BUILD_PULL="$v"
fi
COMPOSE_BUILD_PULL="${COMPOSE_BUILD_PULL:-1}"
if [[ -z "${DOCKER_BUILD_NO_CACHE:-}" ]]; then
  v="$(read_key_from_env_file "$ENV_FILE" DOCKER_BUILD_NO_CACHE)"
  [[ -n "$v" ]] && DOCKER_BUILD_NO_CACHE="$v"
fi
DOCKER_BUILD_NO_CACHE="${DOCKER_BUILD_NO_CACHE:-0}"

compose=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
build_flags=()
if [[ "$COMPOSE_BUILD_PULL" == "1" ]]; then
  build_flags+=(--pull)
  log "Docker 构建将拉取各服务 Dockerfile 中 FROM 的基础镜像（COMPOSE_BUILD_PULL=1）"
else
  log "COMPOSE_BUILD_PULL=0，构建阶段不附加 --pull"
fi
if [[ "$DOCKER_BUILD_NO_CACHE" == "1" ]]; then
  build_flags+=(--no-cache)
  log "DOCKER_BUILD_NO_CACHE=1，构建不使用层缓存（耗时显著增加）"
fi

log "构建业务镜像（orchestrator / ai-worker / media-worker / web）"
"${compose[@]}" build "${build_flags[@]}" orchestrator ai-worker media-worker web || die "docker compose build 失败"

log "启动容器"
"${compose[@]}" up -d || die "docker compose up 失败"

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
  "${compose[@]}" logs --tail 120 web >&2 || true
  die "Web 3000 在多次重试后仍不通（请检查 web 容器是否 OOM、构建失败或端口被占用；可增大 WEB_HEALTH_MAX_ATTEMPTS）"
fi

log "校验 Web 容器内 NEXT_PUBLIC_APP_BUILD_ID 与本次发版一致"
got="$("${compose[@]}" exec -T web sh -c 'printf %s "${NEXT_PUBLIC_APP_BUILD_ID:-}"' 2>/dev/null | tr -d '\r' || true)"
[[ "$got" == "$NEXT_PUBLIC_APP_BUILD_ID" ]] || die "Web 容器内构建号为「${got:-空}」，期望「${NEXT_PUBLIC_APP_BUILD_ID}」。请确认镜像已由本次 compose build 重建且 build.args 已传入。"

hdr="$(curl -fsSI --connect-timeout 3 --max-time 15 http://127.0.0.1:3000/ 2>/dev/null | tr -d '\r' || true)"
if echo "$hdr" | grep -qi '^cache-control:.*\(no-store\|no-cache\)'; then
  log "首页 Cache-Control 含 no-store 或 no-cache（降低浏览器长期缓存 HTML 风险）"
elif echo "$hdr" | grep -qi '^cache-control:'; then
  log "⚠️ 首页 Cache-Control 未识别到 no-store/no-cache；若前有 Nginx/CDN 请对照 DEPLOYMENT.md 检查是否覆盖源站缓存策略"
else
  log "⚠️ 未从首页响应解析到 Cache-Control（curl 失败或头异常）"
fi

log "检查核心容器是否为 running"
for svc in orchestrator web ai-worker media-worker; do
  if [[ -z "$("${compose[@]}" ps -q --status running "$svc" 2>/dev/null || true)" ]]; then
    "${compose[@]}" ps -a >&2 || true
    die "容器 $svc 未处于 running，请查看: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs $svc"
  fi
done

log "发布成功"
log "编排器: http://127.0.0.1:8008/health"
log "Web: http://127.0.0.1:3000/"

if [[ -f "$APP_DIR/scripts/aliyun-cdn-refresh.sh" ]]; then
  log "阿里云 CDN：若已启用 ALIYUN_CDN_REFRESH_ON_RELEASE，将尝试刷新缓存"
  bash "$APP_DIR/scripts/aliyun-cdn-refresh.sh" "$APP_DIR/$ENV_FILE" || log "⚠️ 阿里云 CDN 刷新失败，请在控制台手动刷新（见 DEPLOYMENT.md「Nginx / CDN 与 Web 发版缓存」）"
fi

log "若域名前有 CDN 且未走自动刷新：发版后请在控制台 Purge / 刷新缓存（建议至少 /admin/* 与 /；仍见旧前端时再 Purge /_next/static/*）。Nginx 勿对整条反代做长期 proxy_cache；分层与示例见 DEPLOYMENT.md「Nginx / CDN 与 Web 发版缓存」与 deploy/nginx-prestoai.cdn-cache.example.conf"
