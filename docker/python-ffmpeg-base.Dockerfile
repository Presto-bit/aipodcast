# syntax=docker/dockerfile:1
# 在能访问 Debian apt 的机器上构建，供离线 ECS 使用（见 scripts/build-offline-base-images.sh）
# 需同时满足：orchestrator/ai-worker（ffmpeg）、media-worker（ffmpeg + 中文/日文字体混排字幕）
# 标签示例：aipodcast/python-ffmpeg:3.12-slim-amd64
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM --platform=linux/amd64 ${PYTHON_BASE_IMAGE}

ARG USE_APT_MIRROR=1
ENV USE_APT_MIRROR=${USE_APT_MIRROR}

COPY --chmod=755 docker/debian-apt-bootstrap.sh /usr/local/bin/debian-apt-bootstrap.sh

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    debian-apt-bootstrap.sh ffmpeg fonts-noto-cjk \
    && ffmpeg -version | head -1
