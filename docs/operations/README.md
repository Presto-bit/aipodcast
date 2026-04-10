# 运维与数据：统一入口

本页为 **日常运维、PostgreSQL 单一事实源、发布切流、数据治理** 的索引；细节仍以各专题文档为准，避免在 README / DEPLOYMENT 多处重复维护。

---

## 1. 日常运维

| 动作 | 入口 |
|------|------|
| 全栈 Docker 启停 | 根目录 `Makefile`：`make up` / `make down` / `make logs` |
| 本机热重载（PG/Redis/MinIO 在 Docker，应用在宿主机） | `make dev`、`make dev-api`、`make dev-web` |
| Worker（生产消费队列） | `make dev-worker-ai`、`make dev-worker-media` |
| Worker（开发：代码变更自动重启） | `make dev-worker-ai-watch`、`make dev-worker-media-watch` |
| SQL 迁移 | `make migrate-db`（脚本按 `infra/postgres/init` 顺序执行） |
| 可再生产物清理预览/执行 | `make cleanup-outputs DAYS=30 DRY_RUN=1` / `DRY_RUN=0` |
| 数据保留维护 | `make retention-maintenance DRY_RUN=1` / `DRY_RUN=0` |
| 一致性巡检 | `make check-data-consistency` |
| 本地快速质量门 | `make ci`（`tsc` + `pytest`） |
| Docker 全栈（E2E：Redis `/1` + profile `e2e`） | `make e2e-up` / `make e2e-down` |
| 浏览器端到端 | `make e2e-install`（首次）→ `make e2e`（须栈已就绪，常与 `e2e-up` 同用） |

环境变量模板：`.env.ai-native.example` → 复制为 `.env.ai-native`。

---

## 2. PostgreSQL 单一事实源（完全 PG 化检查清单）

**目标**：账号、订阅、订单等以 **PostgreSQL 为唯一事实源**；JSON 仅只读备份或淘汰；会话优先 **Redis**（见 `FYV_AUTH_SESSION_BACKEND`）。

**推荐生产开关（写入 `.env.ai-native`，与示例中「生产部署建议」一致）**

1. `FYV_AUTH_UNIFIED_PG=1`（或等价：`FYV_AUTH_PG_PRIMARY=1`、`FYV_AUTH_DUAL_WRITE=0`、`FYV_AUTH_JSON_BACKUP_READONLY=1`）。
2. 表结构已由 `infra/postgres/init` + `make migrate-db` 管理时：`FYV_AUTH_RUNTIME_ENSURE_SCHEMA=0`。
3. 需要启动期强校验时：`ORCHESTRATOR_STRICT_SCHEMA=1`。

**迁移与校验（按顺序执行，先 dry-run）**

| 步骤 | 命令 / 文档 |
|------|----------------|
| JSON → PG（用户、订单、音色等） | `make migrate-json-to-pg DRY_RUN=1`，确认后 `DRY_RUN=0`；可选 `PHONE=` 用于音色归属 |
| 文件会话 → Redis | `make migrate-sessions-to-redis DRY_RUN=1`，确认后 `DRY_RUN=0` |
| 用户 JSON 镜像到 PG（可选） | `python3 scripts/sync_users_to_pg.py`（支持 `--dry-run`） |
| 双写观察期 | 短期 `FYV_AUTH_DUAL_WRITE=1`，观察后关闭 |

**回滚思路**：恢复变更前环境变量与备份；切流窗口与灰度指标见 `docs/migration/cutover-runbook.md`。

---

## 3. 发布与部署

| 主题 | 文档 |
|------|------|
| 服务器一键 / Compose / 端口与安全 | [`DEPLOYMENT.md`](../../DEPLOYMENT.md) |
| 大版本切流、灰度、回滚阈值 | [`docs/migration/cutover-runbook.md`](../migration/cutover-runbook.md) |
| 离线包与镜像 | [`docs/offline-deploy-bundle.md`](../offline-deploy-bundle.md) |
| BFF 与网关基线 | [`docs/architecture/bff.md`](../architecture/bff.md)、[`docs/architecture/cloudflare-gateway-baseline.md`](../architecture/cloudflare-gateway-baseline.md) |

---

## 4. 数据治理与合规

| 主题 | 说明 |
|------|------|
| 运行时目录 | `FYV_RUNTIME_DIR` / `FYV_DATA_DIR` / `FYV_UPLOAD_DIR` / `FYV_OUTPUT_DIR`（见 `.env.ai-native.example`） |
| 保留周期 | `.env.ai-native.example` 中 `RETENTION_*` 默认建议（webhook / usage / job_events / subscription_events）；执行入口 `make retention-maintenance` |
| 媒体队列「占位成功」 | 生产建议 `MEDIA_WORKER_FAIL_ON_NON_PODCAST=1`（见 `DEPLOYMENT.md`） |

---

## 5. 端到端测试（Compose profile + Playwright）

### Compose

| 文件 / 开关 | 作用 |
|-------------|------|
| `docker-compose.ai-native.yml` | 默认全栈（Redis 逻辑库 **0**） |
| `docker-compose.e2e.yml` | **叠加**：编排器与 Worker 改用 Redis **`/1`**，与本地默认栈错开 RQ 队列 |
| **`--profile e2e`** | 启动一次性服务 **`e2e-ready`**（`curl` 探测 `web` + `orchestrator` /health，失败非零退出，供 CI 判定） |

**推荐本地一键（与 `make up` 同端口，勿同时起两套）：**

```bash
make e2e-up    # compose 双文件 + --profile e2e
make e2e-install   # 首次安装 Playwright 浏览器
make e2e
make e2e-down
```

等价命令：

```bash
docker compose -f docker-compose.ai-native.yml -f docker-compose.e2e.yml \
  --env-file .env.ai-native --profile e2e up -d --build
```

### CI 与用例

- **工作流**：`.github/workflows/e2e.yml`（`main` / `master` 推送与 `workflow_dispatch`）。
- **用例目录**：`apps/web/e2e/`（浏览器首页 + 编排器 `/health`）。

---

## 与根文档的关系

- [`README.md`](../../README.md)：快速开始、热重载入口、文档链接。  
- **运维与切流**：优先打开 **本页**，再跳到对应专题。
