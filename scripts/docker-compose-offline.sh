#!/usr/bin/env bash
# 离线/无 Docker Hub：在已 docker load 基础镜像后使用本脚本，避免向 registry-1.docker.io 拉 manifest。
# Dockerfile 使用 RUN --mount 缓存 apt/pip，需 BuildKit（默认开启）；若极旧环境异常可显式 DOCKER_BUILDKIT=0（将失去 mount 缓存，可能无法解析多阶段语法时需升级 Docker）。
# 用法（仓库根目录）：bash scripts/docker-compose-offline.sh up -d --build
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-1}"
exec docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native "$@"
