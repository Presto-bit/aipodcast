# Presto AI Podcast（FindingYourVoice）

面向内容创作的 AI 工作台：笔记出播客、AI 播客、文本转语音、音色与作品管理、登录鉴权等。

本仓库**仅保留 AI Native 架构**：Next.js（`apps/web`）+ FastAPI 编排器（`services/orchestrator`）+ RQ Worker + PostgreSQL + Redis + MinIO，由 **Docker Compose** 编排。

共享业务逻辑（MiniMax 客户端、解析器、鉴权 `auth_service` 等）位于编排器内 **`services/orchestrator/app/fyv_shared/`**；与编排器代码一同发布，通过 **`import app.fyv_shared.*`** 引用。运行时上传/数据/产物默认仍落在仓库 **`legacy_backend/`** 目录（可用 `FYV_*` 环境变量覆盖），便于与既有部署路径兼容。

---

## 技术栈

- **前端**：Next.js（`apps/web`），BFF 由 Route Handlers 承担（见 `docs/architecture/bff.md`）
- **API / 任务**：FastAPI、RQ、psycopg2、boto3（MinIO）
- **数据**：PostgreSQL、Redis、对象存储（S3 兼容）
- **音频**：pydub、系统 **ffmpeg** / ffprobe

---

## 目录结构（关键）

```text
minimax_aipodcast/
├─ apps/web/                 # Next.js 前端
├─ services/orchestrator/    # FastAPI 编排器
├─ workers/                  # ai-worker / media-worker
├─ legacy_backend/           # 默认运行时目录（data/uploads/outputs；Python 源码已迁至 app/fyv_shared）
├─ services/orchestrator/app/fyv_shared/  # 共享模块（config、minimax_client、auth_service…）
├─ docker-compose.ai-native.yml
├─ Makefile                  # make up / make down 等
├─ requirements.txt          # 根入口：编排器 pip 依赖（请在仓库根目录 pip install -r）
└─ infra/postgres/           # 数据库初始化
```

---

## 本地开发（Docker，推荐）

### 环境要求

- Docker / Docker Compose（含 compose v2）
- 可选：Python 3.12 + venv（跑集成脚本、本地 `pip install -r requirements.txt`）

### 配置

```bash
cp .env.ai-native.example .env.ai-native
# 编辑 .env.ai-native（至少配置 MINIMAX_API_KEY 等）
```

说明：当前 Docker Compose 部署默认读取 `.env.ai-native`。`/etc/default/aipodcast` 仅用于 systemd `EnvironmentFile` 启动场景。

### 启动

```bash
make up
# 或
docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d --build
```

默认访问：

- Web：`http://localhost:3000`
- 编排器健康检查：`http://127.0.0.1:8008/health`

常用：`make logs`、`make down`。详见根目录 `Makefile`。

### 热重载开发（推荐改 UI / 编排器时）

全栈用 Docker（`make up`）时，镜像内跑的是**构建产物**，改代码要**重建镜像**才能进容器，不适合频繁改。

要**保存即刷新**，用「**基础设施 Docker + 应用本机**」：

1. **先启动 Docker Desktop**（macOS），否则 `make dev` 无法拉取镜像、起 PG/Redis/MinIO。
2. **环境变量**（`.env.ai-native`）：`DB_HOST`、`REDIS_URL`、`OBJECT_ENDPOINT` 指向本机（与 `.env.ai-native.example` 一致，一般为 `127.0.0.1`）；`ORCHESTRATOR_URL` / `NEXT_PUBLIC_ORCHESTRATOR_URL` 为 `http://127.0.0.1:8008`。
3. **依赖**：`make install-deps`（Python）；本机需 **ffmpeg**。
4. **若曾执行过全栈 `make up`**：请先 `make down`，避免本机 `8008`/`3000` 与容器里的 `orchestrator`/`web` 抢端口（本机热重载会占用这两个端口）。

**完整启动（从零到热重载，推荐复制）**

在**仓库根目录** `minimax_aipodcast/` 执行（勿在子目录里 `cd minimax_aipodcast` 拼错路径）：

```bash
cd /path/to/minimax_aipodcast

# 1）环境文件（仅首次或没有时）
test -f .env.ai-native || cp .env.ai-native.example .env.ai-native
# 按需编辑 .env.ai-native 后保存

# 2）依赖：Python + 根目录 / apps/web 的 npm
make install-deps
make dev-install

# 3）一键热重载（已包含 Next，无需再 cd apps/web 执行 npm run dev）
make dev
```

等价一条命令（脚本会：若无 `.env.ai-native` 则复制并**退出提示你先编辑**；有则连续执行 install-deps、dev-install、dev）：

```bash
cd /path/to/minimax_aipodcast && make complete-dev
# 或直接：bash scripts/complete-dev.sh
```

带「释放 8008 + 约 8s 后自动打开浏览器（macOS）」：

```bash
make dev-start
```

说明：`make dev` = `docker compose` 起 PG/Redis/MinIO + 同时跑**编排器**（`npm run dev:api`）与 **Next**（`npm run dev:web`），与再执行一次 `cd apps/web && npm run dev` **重复**，一般不必。

浏览器：**Next** 一般为 `http://localhost:3000`；编排器 `http://127.0.0.1:8008/health`。按 `Ctrl+C` 会结束本机 api/web，**Docker 里的 PG/Redis/MinIO 仍运行**。

**分终端（与一键等价）**

1. `make dev-infra` — 只起 PG / Redis / MinIO  
2. `make dev-api` — 编排器热重载  
3. `make dev-web` — Next 热更新  

或：`make dev-infra` 后执行 `make dev-apps`（同目录下 `npm run dev`，同时起 api + web）。

**Worker（按需）**：异步任务需要队列消费时，另开终端 `make dev-worker-ai` / `make dev-worker-media`。改 Worker 相关代码后需**手动重启**该进程（无 `--reload`）。

---

## 服务器部署

见 [DEPLOYMENT.md](DEPLOYMENT.md)。一键脚本：`sudo bash deploy.sh`（内部调用 Docker Compose）。

### 功能与本地检查

- **全站搜索**：侧栏「搜索」或 `/search`。
- **作品导出**：`/works` 当前 Tab 支持导出 ZIP。
- **播客内容模板**：`/podcast` 正文区模板下拉。
- **后台用量**：管理员 `/admin/usage`（需 PG 已执行 `002_usage_events.sql`）。
- **订阅策略执行手册**：见 `docs/product/subscription-experience-pricing-playbook.md`（体验门槛、升级触发、定价与埋点口径）。
- **CI**：根目录 `make ci`（前端 `tsc`、编排器 pytest）；GitHub Actions 见 `.github/workflows/ci.yml`。
- **用户 JSON → PG 镜像**：`python3 scripts/sync_users_to_pg.py`（可选，`--dry-run` 预览）。

---

## 登录鉴权（文件型用户数据）

启用方式：`FYV_AUTH_ENABLED=1` 等环境变量（可写入 `.env.ai-native`）。鉴权由 **`app.fyv_shared.auth_service`** 实现；生产推荐 **`FYV_AUTH_UNIFIED_PG=1`**（PostgreSQL 为单一事实源，关闭 JSON 双写、JSON 仅只读备份）。默认数据目录仍为 **`legacy_backend/data/`**（可用 `FYV_DATA_DIR` 覆盖）。详见 `.env.ai-native.example`。

运行时目录建议：`data` 存用户/会话/订单/音色收藏等持久数据，`uploads` 存原始上传文件，`outputs` 仅存可再生成物。可通过 `FYV_RUNTIME_DIR` / `FYV_DATA_DIR` / `FYV_UPLOAD_DIR` / `FYV_OUTPUT_DIR` 自定义。

可使用 `make cleanup-outputs DAYS=30 DRY_RUN=1` 预览清理 30 天前产物，确认后执行 `DRY_RUN=0` 真删。

JSON -> PostgreSQL 迁移（users / payment_orders / saved_voices）：

- 预览：`make migrate-json-to-pg DRY_RUN=1 PHONE=18101383358`
- 执行：`make migrate-json-to-pg DRY_RUN=0 PHONE=18101383358`

说明：`PHONE` 仅用于 `saved_voices.json` 归属到指定用户；不传则跳过音色迁移。

会话迁移到 Redis：

- 预览：`make migrate-sessions-to-redis DRY_RUN=1`
- 执行：`make migrate-sessions-to-redis DRY_RUN=0`

说明：`auth_service` 默认优先使用 Redis 会话（`REDIS_URL` 可用时），并保留文件回退；可用 `FYV_AUTH_SESSION_BACKEND=file` 强制走文件。

数据库迁移规范（SQL migration 主导）：

- 所有结构变更优先写入 `infra/postgres/init/*.sql`
- 执行入口：`make migrate-db`
- 代码内 `ensure_*_schema` 仅做兼容兜底（不作为首选迁移手段）

认证与订阅审计新增：

- `user_auth_accounts`：认证主数据（密码哈希、状态、登录失败次数等）
- `payment_webhook_deliveries`：支付回调投递审计（验签结果、payload hash、处理结果）
- `subscription_current_state`：订阅当前态物化（由事件驱动更新）

鉴权开关（可选）：

- `FYV_AUTH_PG_PRIMARY=1`：认证主读 PG（默认开）
- `FYV_AUTH_DUAL_WRITE=1`：登录/注册等双写 JSON+PG（观察期）
- `FYV_AUTH_JSON_BACKUP_READONLY=1`：JSON 仅读备份（默认开）

数据治理增强：

- 订阅事件类型标准化（`subscription_events.event_type`），并驱动 `subscription_current_state` 物化更新
- 支付回调幂等增强：`payment_webhook_deliveries` 按 `(provider, event_id, payload_hash)` 聚合，累计 `delivery_count`
- 审计追踪链路：`trace_id/request_id` 写入 `subscription_events/payment_orders/payment_webhook_deliveries`
- 数据保留建议周期：webhook 180 天、usage/job_events 365 天、subscription_events 730 天
- 维护命令：`make retention-maintenance DRY_RUN=1`（预览）/ `DRY_RUN=0`（执行）

---

## 免责声明

请勿将敏感密钥硬编码到仓库。生产环境请使用环境变量或密钥管理服务。
