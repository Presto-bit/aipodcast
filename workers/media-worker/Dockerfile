# syntax=docker/dockerfile:1
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM --platform=linux/amd64 ${PYTHON_BASE_IMAGE}

ARG USE_APT_MIRROR=1
ENV USE_APT_MIRROR=${USE_APT_MIRROR}

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY --chmod=755 docker/debian-apt-bootstrap.sh /usr/local/bin/debian-apt-bootstrap.sh

# pydub 依赖 ffmpeg/ffprobe；预构建基础镜像可跳过 apt（见 docker/python-ffmpeg-base.Dockerfile）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    set -eux; \
    if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then \
      echo "ffmpeg/ffprobe already present, skip apt-get"; \
    else \
      debian-apt-bootstrap.sh ffmpeg fonts-noto-cjk; \
    fi

COPY services/orchestrator/requirements.txt /app/requirements.txt
COPY docker/offline-pip-wheels /opt/pip-offline-wheels
COPY docker/pip.conf /etc/pip.conf
RUN --mount=type=cache,target=/root/.cache/pip \
    if ls /opt/pip-offline-wheels/*.whl >/dev/null 2>&1; then \
      pip install --no-index --find-links=/opt/pip-offline-wheels -r /app/requirements.txt; \
    else \
      pip install --no-cache-dir -r /app/requirements.txt; \
    fi

COPY services/orchestrator /app/services/orchestrator
COPY legacy_backend /app/legacy_backend
COPY workers/redis_client.py /app/redis_client.py
COPY workers/media-worker/worker.py /app/worker.py

CMD ["python", "/app/worker.py"]
