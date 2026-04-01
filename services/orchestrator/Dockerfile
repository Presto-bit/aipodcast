# 无法访问 docker.io 时：在 .env.ai-native 设 PYTHON_BASE_IMAGE=你的ACR地址/python:3.12-slim，或先 docker load 同名本地镜像
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 与 worker 一致：部分接口或调试路径会经 pydub 读音频；缺 ffmpeg 时易出现 ffprobe 报错
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY services/orchestrator/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY services/orchestrator /app
COPY legacy_backend /app/legacy_backend

EXPOSE 8008

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
