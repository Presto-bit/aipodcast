#!/usr/bin/env bash
# 离线/无 Docker Hub：在已 docker load 基础镜像后使用本脚本，避免 BuildKit 向 registry-1.docker.io 拉 manifest。
# 用法（仓库根目录）：bash scripts/docker-compose-offline.sh up -d --build
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export DOCKER_BUILDKIT=0
export COMPOSE_DOCKER_CLI_BUILD=0
exec docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native "$@"
