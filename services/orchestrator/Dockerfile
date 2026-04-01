# 生产 ECS 多为 linux/amd64。若在 arm64（如 Apple Silicon）上 docker save，须先 pull --platform linux/amd64，否则会 exec format error。
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM --platform=linux/amd64 ${PYTHON_BASE_IMAGE}

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 若 PYTHON_BASE_IMAGE 已含 ffmpeg（如 aipodcast/python-ffmpeg:3.12-slim-amd64），跳过 apt，适合服务器无法访问 Debian 源时构建
RUN set -eux; \
    if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then \
      echo "ffmpeg/ffprobe already present, skip apt-get"; \
    else \
      apt-get update; \
      apt-get install -y --no-install-recommends ffmpeg; \
      rm -rf /var/lib/apt/lists/*; \
    fi

COPY services/orchestrator/requirements.txt /app/requirements.txt
COPY docker/offline-pip-wheels /opt/pip-offline-wheels
# 用 /bin/sh（dash）可解析的写法；勿用 $$ 变量以免 BuildKit 下报 Syntax error: "(" unexpected
RUN if ls /opt/pip-offline-wheels/*.whl >/dev/null 2>&1; then \
      pip install --no-index --find-links=/opt/pip-offline-wheels -r /app/requirements.txt; \
    else \
      pip install --no-cache-dir -r /app/requirements.txt; \
    fi

COPY services/orchestrator /app
COPY legacy_backend /app/legacy_backend

EXPOSE 8008

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
