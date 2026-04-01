ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM --platform=linux/amd64 ${PYTHON_BASE_IMAGE}

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

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
RUN if ls /opt/pip-offline-wheels/*.whl >/dev/null 2>&1; then \
      pip install --no-index --find-links=/opt/pip-offline-wheels -r /app/requirements.txt; \
    else \
      pip install --no-cache-dir -r /app/requirements.txt; \
    fi

COPY services/orchestrator /app/services/orchestrator
COPY legacy_backend /app/legacy_backend
COPY workers/ai-worker/worker.py /app/worker.py

CMD ["python", "/app/worker.py"]
