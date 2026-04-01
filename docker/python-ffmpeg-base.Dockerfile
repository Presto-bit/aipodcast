# 在能访问 Debian apt 的机器上构建，供离线 ECS 使用（见 scripts/build-offline-base-images.sh）
# 标签示例：aipodcast/python-ffmpeg:3.12-slim-amd64
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM --platform=linux/amd64 ${PYTHON_BASE_IMAGE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -1
