# 部署指南（AI Native / Docker）

日常运维、**PostgreSQL 单一事实源检查清单**、数据治理与 E2E 说明的索引见 [`docs/operations/README.md`](docs/operations/README.md)。

## 前提

- 服务器已安装 **Docker** 与 **Docker Compose**（插件 `docker compose`）
- **安全组**：对外只放行 **Web**（经 Nginx 后的 `80`/`443`，或内网访问 Docker 映射的 `3000`）。**编排器 `8008` 不应对公网开放**，仅本机 / Docker 内网 / BFF 可达。

## Compose 默认行为（`docker-compose.ai-native.yml`）

- **宿主机端口**：`5432` / `6379` / `9000` / `9001` / `8008` / `3000` 默认绑定 **`127.0.0.1`**，避免局域网或公网直连数据库、Redis、MinIO 与编排器；Nginx 反代 **`127.0.0.1:3000`** 即可对外提供 Web。
- **Postgres / MinIO 凭据**：容器内 `POSTGRES_*` 与 MinIO root 用户分别取自 `.env.ai-native` 的 **`DB_*`**、**`OBJECT_ACCESS_KEY` / `OBJECT_SECRET_KEY`**（与编排器连接配置一致）。**若数据卷已用旧密码初始化**，仅改 `.env` 不会自动改库内角色口令，须先在库内 `ALTER USER` 再改 env（见下节）。
- **可靠性**：核心服务使用 **`restart: unless-stopped`**；编排器与 Web 配置了 **healthcheck**，`web` 与 Worker 在编排器健康后再依赖启动，减少「半启动」竞态。
- **`release.sh`**：支持 **`GIT_PULL=0`** 跳过 `git fetch/pull`；发布末尾会检查 `orchestrator` / `web` / `ai-worker` / `media-worker` 是否为 **running**。

### PostgreSQL：已有数据卷时更换 `DB_PASSWORD`（换密流程）

Docker 官方镜像在**数据目录已存在**时**不会**根据新的 `POSTGRES_PASSWORD` 去改库内已有角色的密码；应用侧的 `DB_PASSWORD` 必须与库里该用户口令一致，否则编排器 / Worker 会连库失败。

**推荐顺序（不停库、不重建卷）**

1. **在仍在运行的 Postgres 容器里**，用当前能连上的账号执行改密（把 `aipodcast` 换成你的 `DB_USER`，密码按实际替换）：

   ```bash
   cd /path/to/minimax_aipodcast
   docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native exec postgres \
     psql -U aipodcast -d postgres \
     -c "ALTER USER aipodcast WITH PASSWORD '此处填新密码';"
   ```

   若 `psql` 要求输入密码，可先导出旧口令再执行（示例，勿把真实密码写进 shell 历史时可改用临时脚本或 `read -s`）：

   ```bash
   PGPASSWORD='旧密码' docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native exec -e PGPASSWORD postgres \
     psql -h 127.0.0.1 -U aipodcast -d postgres \
     -c "ALTER USER aipodcast WITH PASSWORD '新密码';"
   ```

2. **修改** `.env.ai-native` 中的 **`DB_PASSWORD=`** 与上一步新密码**完全一致**，保存。

3. **让应用进程重新读 env**（任选其一）：

   ```bash
   docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d --force-recreate orchestrator ai-worker media-worker web
   ```

   `postgres` 容器若仅 env 中的 `POSTGRES_PASSWORD` 与库内已同步，一般**不必**为换应用口令而重建；若你也改了 `POSTGRES_PASSWORD` 且希望与库一致，可在确认 `ALTER USER` 已成功后再 `up -d postgres`（注意：重建 postgres 容器**不会**单独抹掉数据卷，数据仍在 `pg_data`）。

**密码含单引号等特殊字符时**：在 SQL 里用 PostgreSQL 美元引用，例如 `ALTER USER aipodcast WITH PASSWORD $pwd$O'reilly$42$pwd$;`（把 `$pwd$…$pwd$` 中间换成你的新口令）。

**无法接受停机或丢失数据的场景**：不要用「删卷重建」代替上述流程；仅在测试环境或确认可丢弃 `pg_data` 时才考虑重建卷。

## 推荐流程

1. 克隆代码到如 `/opt/minimax_aipodcast`，**不要用 root** 日常开发目录放在 `/root` 下给普通用户跑容器时易踩权限坑。
2. 复制并编辑环境变量：

   ```bash
   cp .env.ai-native.example .env.ai-native
   nano .env.ai-native
   ```

   说明：Docker Compose 部署默认读取项目根目录 `.env.ai-native`（包括 `MINIMAX_API_KEY` 等）。
   仅当你采用 systemd `EnvironmentFile` 启动时，才需要改用 `/etc/default/aipodcast`。

3. 启动：

   ```bash
   cd /opt/minimax_aipodcast
   sudo bash deploy.sh --yes
   ```

   或直接使用：

   ```bash
   docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d --build
   ```

4. 验证：

   ```bash
   curl -s http://127.0.0.1:8008/health
   curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/
   ```

## 数据库迁移

- 首次部署或升级编排器后，请确保 PostgreSQL 已执行 `infra/postgres/init/` 下 SQL（Compose 首次建库会自动挂载；**已有库**需手动执行增量脚本）。
- `002_usage_events.sql`：任务终态用量事件与后台「用量汇总」依赖此表；未执行时用量写入会静默跳过、汇总为空。
- 若需将 JSON 用户镜像到 PG（便于审计/关联），可在配置好 `DB_*` 后执行：`python3 scripts/sync_users_to_pg.py`（支持 `--dry-run`）。

### 生产：启动期 Schema 严格模式

- 设置 **`ORCHESTRATOR_STRICT_SCHEMA=1`**：对象存储就绪、各表 DDL 兜底步骤**任一失败则进程退出**，避免「带病启动」导致功能半残。
- 默认不开启时：失败会打 **error 级日志**（`orchestrator startup failed: …`），进程仍启动，便于本地排障。

### 数据单一事实源（鉴权 / 用户）

- 编排器与 Worker 以 **PostgreSQL** 为任务、订阅、笔记等主存；`legacy_backend/data/*.json` 多为兼容或只读镜像。
- **推荐生产**：设置 **`FYV_AUTH_UNIFIED_PG=1`**（关闭向 JSON 的双写、JSON 仅只读备份，PG 为账号与订阅事实源）。亦可手动配置 **`FYV_AUTH_PG_PRIMARY=1`**、**`FYV_AUTH_DUAL_WRITE=0`**、**`FYV_AUTH_JSON_BACKUP_READONLY=1`**。详见 `.env.ai-native.example`。

## 生产环境建议（安全）

- 在宿主机前加 **Nginx**，将 `80`/`443` 反代到 `127.0.0.1:3000`（Web），**不要**把 Docker 端口不加限制地暴露到公网。
- **`8008`（编排器）**：仅绑定 `127.0.0.1` 或通过 Docker **internal 网络** 供 `web` 容器访问；勿在公网安全组放行 `8008`。
- 浏览器与公网流量**只进 Next（BFF）**；BFF 使用 **`INTERNAL_SIGNING_SECRET`** 等对编排器请求签名（见 `docs/architecture/bff.md`）。
- 将 `MINIMAX_API_KEY`、`INTERNAL_SIGNING_SECRET`、`PAYMENT_WEBHOOK_SECRET`、`ORCHESTRATOR_API_TOKEN` 等放在仅宿主机可读的环境文件或密钥管理，**不要**提交到 Git。
- **生产禁止** `PAYMENT_WEBHOOK_ALLOW_UNSIGNED=1`（未配置 `PAYMENT_WEBHOOK_SECRET` 且未允许无签时，编排器会对回调返回 503，避免误接未验签流量）。

## 支付回调

- **入口（公网）**：支付平台或网关应 POST 至 **Next 对外域名** 下的 BFF 路径（由 `apps/web` 路由转发），由 BFF 将**原始 body** 与 **`X-Payment-Signature`** 转发到编排器 **`POST /api/v1/webhooks/payment`**。
- **编排器**：实现 JSON 解析、**`PAYMENT_WEBHOOK_SECRET` 下 HMAC-SHA256(body)** 验签、投递审计表、订单/订阅字段归一及幂等处理；支付宝电脑网站支付异步通知为 **`POST /api/v1/webhooks/alipay`**（`application/x-www-form-urlencoded`，RSA2 验签，见 `alipay_page_pay`）。公网域名建议配置 **`ALIPAY_NOTIFY_URL=https://你的域名/api/webhooks/alipay`**，由 Next BFF 原样转发 body 至编排器。
- 配置示例见 `.env.ai-native.example` 中 `PAYMENT_WEBHOOK_SECRET` / `ALIPAY_*`。本地联调可临时 `PAYMENT_WEBHOOK_ALLOW_UNSIGNED=1`，**不得用于生产**。

## 媒体 Worker（非播客类型）

- 队列任务类型 **`podcast_generate` / `podcast`** 走完整脚本 + TTS 管线。
- **其它 `job_type`** 当前为**占位成功**（无真实成片）。生产若需禁止此类任务「假成功」，可设 **`MEDIA_WORKER_FAIL_ON_NON_PODCAST=1`**（任务将失败并带明确原因）。详见编排器日志与任务事件流。
