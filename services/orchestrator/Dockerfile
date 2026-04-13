# syntax=docker/dockerfile:1
# 生产 ECS 多为 linux/amd64。若在 arm64（如 Apple Silicon）上 docker save，须先 pull --platform linux/amd64，否则会 exec format error。
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM --platform=linux/amd64 ${PYTHON_BASE_IMAGE}

ARG USE_APT_MIRROR=1
ENV USE_APT_MIRROR=${USE_APT_MIRROR}

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY --chmod=755 docker/debian-apt-bootstrap.sh /usr/local/bin/debian-apt-bootstrap.sh

# BuildKit cache：重复构建可复用已下载的 .deb；不改变业务代码时该层通常命中缓存
# 若 PYTHON_BASE_IMAGE 已含 ffmpeg，跳过 apt（见 .env.ai-native 中 PYTHON_BASE_IMAGE 预构建镜像）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    set -eux; \
    if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then \
      echo "ffmpeg/ffprobe already present, skip apt-get"; \
    else \
      debian-apt-bootstrap.sh ffmpeg ca-certificates; \
    fi

COPY services/orchestrator/requirements.txt /app/requirements.txt
COPY docker/offline-pip-wheels /opt/pip-offline-wheels
COPY docker/pip.conf /etc/pip.conf
# 用 /bin/sh（dash）可解析的写法；勿用 $$ 变量以免 BuildKit 下报 Syntax error: "(" unexpected
RUN --mount=type=cache,target=/root/.cache/pip \
    if ls /opt/pip-offline-wheels/*.whl >/dev/null 2>&1; then \
      pip install --no-index --find-links=/opt/pip-offline-wheels -r /app/requirements.txt; \
    else \
      pip install --no-cache-dir -r /app/requirements.txt; \
    fi

COPY services/orchestrator /app
COPY legacy_backend /app/legacy_backend

EXPOSE 8008

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
