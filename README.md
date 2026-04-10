# Presto AI Podcast（FindingYourVoice）

AI 内容工作台：**Next.js**（`apps/web`）+ **FastAPI**（`services/orchestrator`）+ **RQ Worker** + **PostgreSQL** + **Redis** + **MinIO**，Docker Compose 编排。共享逻辑在 `services/orchestrator/app/fyv_shared/`；默认数据目录 `legacy_backend/`（`FYV_*` 可改）。

## 快速开始

```bash
cp .env.ai-native.example .env.ai-native   # 至少补 MINIMAX_API_KEY 等
make up
```

- Web：`http://localhost:3000`
- 编排器：`http://127.0.0.1:8008/health`

`make down` / `make logs`。更多目标见根目录 **`Makefile`**。

## 本机热重载（改代码）

Docker 只起 PG / Redis / MinIO，应用跑在本机：`make install-deps && make dev-install && make dev`（需 Docker 与 **ffmpeg**；详见 `.env.ai-native.example`）。全栈 `make up` 与热重载会抢 `3000`/`8008`，按需先 `make down`。

## 文档

- 部署：[DEPLOYMENT.md](DEPLOYMENT.md)
- 产品：[docs/product/README.md](docs/product/README.md)
- 运维 / 迁移 / E2E：[docs/operations/README.md](docs/operations/README.md)

