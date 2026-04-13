#!/usr/bin/env bash
# 在「能访问 Docker Hub + Debian apt」的机器上执行，生成带 ffmpeg 的 Python 基础镜像，便于 docker save 后上传到无 apt 环境的服务器。
# 用法（仓库根目录）：
#   bash scripts/build-offline-base-images.sh
#   docker save -o bases-amd64.tar aipodcast/python-ffmpeg:3.12-slim-amd64 postgres:16-alpine redis:7-alpine minio/minio:latest node:20-alpine
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="${OFFLINE_PYTHON_FFMPEG_TAG:-aipodcast/python-ffmpeg:3.12-slim-amd64}"

docker build \
  --platform linux/amd64 \
  -f docker/python-ffmpeg-base.Dockerfile \
  --build-arg "USE_APT_MIRROR=${USE_APT_MIRROR:-1}" \
  -t "${TAG}" \
  .

echo ""
echo "已构建: ${TAG}"
echo "在 .env.ai-native 中设置: PYTHON_BASE_IMAGE=${TAG}"
echo "打包示例（按需追加其它镜像）:"
echo "  docker save -o bases-amd64.tar ${TAG} postgres:16-alpine redis:7-alpine minio/minio:latest node:20-alpine"
