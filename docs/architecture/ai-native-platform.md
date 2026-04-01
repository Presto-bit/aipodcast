# AI-Native 平台底座说明

## 服务分层
- `apps/web`：Next.js + Tailwind 前端；[BFF（Route Handlers）说明](./bff.md)。
- `services/orchestrator`：FastAPI 中枢编排服务，管理任务生命周期与事件流。
- `workers/ai-worker`：消费 AI 队列，执行解析 + 生成任务。
- `workers/media-worker`：消费媒体队列（当前为占位流程，可接 Remotion/FFmpeg）。
- `infra/postgres/init`：PostgreSQL 初始化脚本。

## 任务状态机
- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

## 统一事件协议
- `progress`
- `log`
- `error`
- `complete`
- `terminal`（仅事件流终态通知）

## 本地启动
1. 复制环境变量：`cp .env.ai-native.example .env.ai-native`
2. 启动容器：`docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d --build`
3. 访问：
   - Web: `http://localhost:3000`
   - Orchestrator: `http://localhost:8008/health`
   - MinIO Console: `http://localhost:9001`

## Worker 运行模式
- 环境变量：`RQ_WORKER_MODE`（`auto` / `simple` / `standard`，默认 `auto`）。
- `auto`：macOS 使用 `SimpleWorker`（避免 fork 问题），Linux 使用标准 `Worker`。
- 本地排障建议：显式设置 `RQ_WORKER_MODE=simple`，减少平台差异导致的队列异常。
