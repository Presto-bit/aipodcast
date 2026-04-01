#!/usr/bin/env bash
# 在能访问 Docker Hub（及 PyPI/npm）的机器上：pull 基础镜像、构建全栈、打成单个 tar，供离线服务器 docker load。
# Apple Silicon 请先: export DOCKER_DEFAULT_PLATFORM=linux/amd64
# 用法（仓库根目录）：
#   bash scripts/save-full-stack-tar.sh [输出文件.tar]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.ai-native}"
OUT_TAR="${1:-aipodcast-full-stack-amd64.tar}"
COMPOSE=(docker compose -f docker-compose.ai-native.yml --env-file "$ENV_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE，请先复制 .env.ai-native.example 并编辑" >&2
  exit 1
fi

# 仅解析 save 所需的键，避免 source 整个 .env（含空格未加引号的值会报 command not found）
read_env_key() {
  local key="$1" file="$2" line val
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[$' \t']}" ]] && continue
    if [[ "$line" =~ ^[[:space:]]*${key}=(.*)$ ]]; then
      val="${BASH_REMATCH[1]}"
      val="${val%$'\r'}"
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      printf '%s' "$val"
      return 0
    fi
  done < "$file"
  return 1
}

PG="$(read_env_key POSTGRES_IMAGE "$ENV_FILE" || true)"
RD="$(read_env_key REDIS_IMAGE "$ENV_FILE" || true)"
MN="$(read_env_key MINIO_IMAGE "$ENV_FILE" || true)"
TAG="$(read_env_key AIPODCAST_IMAGE_TAG "$ENV_FILE" || true)"
PG="${PG:-postgres:16-alpine}"
RD="${RD:-redis:7-alpine}"
MN="${MN:-minio/minio:latest}"
TAG="${TAG:-latest}"

echo ">>> pull 基础设施镜像（amd64）…"
docker pull --platform linux/amd64 "$PG"
docker pull --platform linux/amd64 "$RD"
docker pull --platform linux/amd64 "$MN"

echo ">>> build 编排器 / worker / web…"
"${COMPOSE[@]}" build

echo ">>> docker save -> $OUT_TAR"
docker save -o "$OUT_TAR" \
  "$PG" \
  "$RD" \
  "$MN" \
  "aipodcast-orchestrator:$TAG" \
  "aipodcast-ai-worker:$TAG" \
  "aipodcast-media-worker:$TAG" \
  "aipodcast-web:$TAG"

ls -lh "$OUT_TAR"
echo ""
echo "服务器上: docker load -i $(basename "$OUT_TAR")"
echo "然后解压同版本源码、配置 $ENV_FILE，执行:"
echo "  docker compose -f docker-compose.ai-native.yml --env-file $ENV_FILE up -d"
echo "（无需再 --build，除非改代码需重建）"
