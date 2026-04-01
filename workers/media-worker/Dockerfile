FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# pydub 依赖 ffmpeg/ffprobe（系统 PATH）；镜像源偶发 502 时可重试构建
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY services/orchestrator/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY services/orchestrator /app/services/orchestrator
COPY legacy_backend /app/legacy_backend
COPY workers/media-worker/worker.py /app/worker.py

CMD ["python", "/app/worker.py"]
