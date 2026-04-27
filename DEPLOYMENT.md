# 部署指南（AI Native / Docker）

日常运维、**PostgreSQL 单一事实源检查清单**、数据治理与 E2E 说明的索引见 [`docs/operations/README.md`](docs/operations/README.md)。

## 前提

- 服务器已安装 **Docker** 与 **Docker Compose**（插件 `docker compose`）；若使用一键脚本，可在 **Ubuntu/Debian** 上由脚本通过 apt 安装 `docker.io` 与 **Compose v2 插件**。
- **安全组**：对外只放行 **Web**（经 Nginx 后的 `80`/`443`，或内网访问 Docker 映射的 `3000`）。**编排器 `8008` 不应对公网开放**，仅本机 / Docker 内网 / BFF 可达。
- **环境文件**：`.env.ai-native` **不提交 Git**。首次从 [`.env.ai-native.example`](.env.ai-native.example) 复制后按需填写（含 `MINIMAX_API_KEY` 等）。

## 发布流程：首次上线与后续发版

| 阶段 | 是否重装宿主机 Docker / 系统包 | 代码来源 | 典型命令 |
|------|----------------------------------|----------|----------|
| **首次发布** | 一键脚本可选安装 Docker；已有 Docker 则跳过 | `git clone` 或拷贝离线包 | `sudo bash deploy.sh --yes` 或见下文「方式 B」 |
| **后续发版** | **不需要**重装环境（除非升级说明要求） | 远端 Git `pull`（或固定目录已同步的代码） | `bash release.sh`（或 `GIT_PULL=0` + 手动同步后同一套 `compose up`） |

### 首次发布（新机器 / 首次上线）

1. **目录与用户**  
   - 将仓库放到固定目录（生产推荐 **`/opt/FYV`**；其他路径发版时设置 `APP_DIR`），由**普通用户**（如 `ubuntu`）持有目录与 Git 工作区；避免仅用 `/root` 长期跑栈，减少权限与卷挂载问题。

2. **获取代码**  
   - **在线**：`git clone <你的仓库 URL> /opt/FYV`  
   - **离线**：按 [`docs/offline-deploy-bundle.md`](docs/offline-deploy-bundle.md) 准备镜像与源码包，解压到同一路径并配置 `.env.ai-native`。

3. **配置环境变量**（在仓库根目录）  
   ```bash
   cd /opt/FYV
   cp .env.ai-native.example .env.ai-native
   nano .env.ai-native   # 或 vim；至少补齐密钥与 DB/对象存储等
   ```

4. **启动全栈（二选一）**  
   - **方式 A：一键脚本（推荐新机器）** — 以 root/sudo 执行，可选 **apt 安装 Docker**、将运行用户加入 `docker` 组、在 Git 仓库内 **`git pull --ff-only`**（若存在 `.git`）、再 **`docker compose up -d --build`**（离线模式见脚本 `--offline`）：  
     ```bash
     cd /opt/FYV
     sudo bash deploy.sh --yes --user ubuntu --root /opt/FYV
     ```  
     等价入口为 [`deploy/one_click_deploy.sh`](deploy/one_click_deploy.sh)；可用 `--no-apt` 跳过 apt、`--no-git-pull` 跳过拉代码。  
   - **方式 B：已有 Docker** — 无需重装 Docker 时，在**具有 docker 权限的用户**下：  
     ```bash
     cd /opt/FYV
     docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d --build
     ```

5. **健康检查**  
   ```bash
   curl -s http://127.0.0.1:8008/health
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
   ```

6. **数据库与迁移**  
   - 新库首次起栈时，`infra/postgres/init/` 会随 Compose 挂载执行；**已有旧库升级**时可能需手动执行**增量 SQL**，见下文 [数据库迁移](#数据库迁移)。  
   - 生产建议的 PG 单一事实源与 `FYV_AUTH_*` 等见 [数据单一事实源](#数据单一事实源鉴权--用户) 与 [`docs/operations/README.md`](docs/operations/README.md)。

7. **反向代理（生产）**  
   - 宿主机前加 **Nginx**，`80`/`443` 反代到 **`127.0.0.1:3000`**；勿将数据库、Redis、MinIO、`8008` 暴露到公网，详见下文 [生产环境建议](#生产环境建议安全)。**HTML 与静态资源的缓存分层、发版后 CDN Purge、Nginx 示例**见下文「**Nginx / CDN 与 Web 发版缓存**」一节。

### 后续发版（代码已上线后的常规更新）

**不需要**再次执行「安装 Docker / 系统依赖」类步骤；每次发版主要是 **更新代码 + 重建并启动容器**（`--build` 会在镜像内安装应用依赖，属正常构建）。

1. **开发侧**  
   - 本地修改 → `git commit` → `git push` 到远端（如 `origin/main`）。

2. **服务器侧**（SSH 登录，使用**能执行 `docker compose` 的用户**，通常为部署用户且已在 `docker` 组内）  
   - 进入项目目录，执行仓库根目录的 **[`release.sh`](release.sh)**：  
     ```bash
     cd /opt/FYV
     bash release.sh
     ```  
   - 脚本默认行为：`git fetch` + **`git pull --ff-only`**（与 `REMOTE`/`BRANCH` 一致）→ **`docker compose ... up -d --build`** → 检查编排器 `/health`、Web `3000`、以及 `orchestrator` / `web` / `ai-worker` / `media-worker` 是否为 **running**。

3. **常用环境变量（`release.sh`）**  

   | 变量 | 默认 | 说明 |
   |------|------|------|
   | `APP_DIR` | `/opt/FYV` | 项目根目录（与仓库实际路径一致；否则 `export APP_DIR=…`） |
   | `REMOTE` | `origin` | Git 远端名 |
   | `BRANCH` | `main` | 拉取分支；生产若用其他分支，发版前 `export BRANCH=…` |
   | `GIT_PULL` | `1` | 设为 `0` 则**不**执行 `git fetch/pull`（离线、手工覆盖目录、或打 tag 固定版本时） |

   示例：非 `main` 分支、目录在非默认路径：  
   `APP_DIR=/data/aipodcast BRANCH=production bash release.sh`

4. **`git pull --ff-only` 失败时**  
   - 多为服务器工作区有本地修改、冲突或非快进历史。处理完冲突或改为干净检出后重试；**不要**在不了解影响时强推覆盖生产机历史。

5. **版本说明中的数据库变更**  
   - 若发版说明要求执行新的 SQL 或 `make migrate-db`，在维护窗口内按 [数据库迁移](#数据库迁移) 与运维文档执行后再或同时发版。

6. **`.env.ai-native`**  
   - 一般无需每次发版都改；仅当新版本增加或变更配置项时，对比 `.env.ai-native.example` 后合并到服务器上的 `.env.ai-native`，再执行 `docker compose ... up -d`（或 `release.sh` 已包含 `up -d --build`）。

---

## Compose 默认行为（`docker-compose.ai-native.yml`）

- **宿主机端口**：`5432` / `6379` / `9000` / `9001` / **`9443`** / `8008` / `3000` 默认绑定 **`127.0.0.1`**，避免局域网或公网直连数据库、Redis、MinIO 与编排器；Nginx 反代 **`127.0.0.1:3000`** 即可对外提供 Web。**`9443`** 为 **`minio-https`**（Caddy）对 MinIO S3 API 的 **HTTPS** 出口，编排器默认 **`OBJECT_PRESIGN_ENDPOINT=https://127.0.0.1:9443`** 生成浏览器可加载的预签名链接；公网站点请在 `.env.ai-native` 改为 **`https://你的域名`** 并在主机反代到 MinIO。
- **Postgres / MinIO 凭据**：容器内 `POSTGRES_*` 与 MinIO root 用户分别取自 `.env.ai-native` 的 **`DB_*`**、**`OBJECT_ACCESS_KEY` / `OBJECT_SECRET_KEY`**（与编排器连接配置一致）。**若数据卷已用旧密码初始化**，仅改 `.env` 不会自动改库内角色口令，须先在库内 `ALTER USER` 再改 env（见下节）。
- **可靠性**：核心服务使用 **`restart: unless-stopped`**；编排器与 Web 配置了 **healthcheck**，`web` 与 Worker 在编排器健康后再依赖启动，减少「半启动」竞态。
- **`release.sh`**：支持 **`GIT_PULL=0`** 跳过 `git fetch/pull`；发布末尾会检查 `orchestrator` / `web` / `ai-worker` / `media-worker` 是否为 **running**。

### 对象存储：公网 HTTPS 预签名（浏览器 / RSS / 外部回调）

- **`OBJECT_ENDPOINT`**：编排器与 Worker **读写** MinIO 用，Compose 内保持 **`http://minio:9000`** 即可。
- **`minio-https` 服务**：仓库自带 **Caddy** 将 **`https://127.0.0.1:9443`** 反代到 **`minio:9000`**（`tls internal` 自签证书，本机调试用）。编排器环境变量默认 **`OBJECT_PRESIGN_ENDPOINT=${OBJECT_PRESIGN_ENDPOINT:-https://127.0.0.1:9443}`**，与预签名 URL Host 一致即可根治本机 **HTTPS 页播放混合内容**。
- **`OBJECT_PRESIGN_ENDPOINT`**：仅影响 **`generate_presigned_url` 生成的链接 Host**；**公网生产**须改为 **`https://你的反代域名`**（证书与 DNS 指向反代，反代再转发到 MinIO 9000 API），否则远端用户浏览器无法访问 `127.0.0.1:9443`。
- 生产 **`FYV_PRODUCTION=1`** 且未配置公网预签名时，编排器启动会 **记录 WARNING**；任务详情 JSON 中误存的 **`http://minio:9000/...` 类 `audio_url` / 封面** 在 API 序列化时会被 **置空**，避免前端混合内容，客户端应依赖 **`audio_object_key` + `/work-listen`** 或重新跑任务生成合法外链。

### Docker：`web` 构建拉取 Node 基础镜像失败（metadata / content size of zero）

多为 **直连 Docker Hub** 在国内不可达或限流。`docker-compose.ai-native.yml` 中 **`web` 构建默认已使用**  
`swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-alpine`（同步官方 `library/node:20-alpine`）；`git pull` 到该默认后重新 `bash release.sh` 即可。

若仍失败或你在**海外**希望用 Hub 短名：在 `.env.ai-native` 设 **`NODE_BASE_IMAGE=node:20-alpine`**，并为 Docker 配置 **`registry-mirrors`**（`/etc/docker/daemon.json`，`systemctl restart docker`）。详见 **`.env.ai-native.example`**「Docker 镜像与离线构建」。

### PostgreSQL：已有数据卷时更换 `DB_PASSWORD`（换密流程）

Docker 官方镜像在**数据目录已存在**时**不会**根据新的 `POSTGRES_PASSWORD` 去改库内已有角色的密码；应用侧的 `DB_PASSWORD` 必须与库里该用户口令一致，否则编排器 / Worker 会连库失败。

**推荐顺序（不停库、不重建卷）**

1. **在仍在运行的 Postgres 容器里**，用当前能连上的账号执行改密（把 `aipodcast` 换成你的 `DB_USER`，密码按实际替换）：

   ```bash
   cd /opt/FYV
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

## Nginx / CDN 与 Web 发版缓存

面向 **Next.js**（`/_next/static/*` 带 content hash）：目标是 **HTML 能尽快换新引用**，静态 chunk 仍可 **长缓存**；避免「整条反代 + CDN」把 **HTML** 也缓存成很久不变，导致发版后浏览器仍拉旧 chunk。

### 1）别让 Nginx / CDN 把 HTML（或整条反代）缓存成「很久不变」

- **Nginx**
  - **不要**对 `location /` 套 **`proxy_cache`** 且不区分路径，否则容易把 **HTML API 响应** 一并磁盘缓存，发版后仍像旧站。
  - 对 **`/api/`** 建议单独 `location`：显式 `proxy_intercept_errors off;`、透传 `X-Request-ID`，并保留 PATCH/OPTIONS，避免上游 JSON 错误被网关改写为空 HTML（见 `deploy/nginx-prestoai.cdn-cache.example.conf` 的 API 片段）。
  - 若必须做边缘/磁盘缓存：**只对**明确路径（例如仅 `/_next/static/`）启用，或严格跟随源站 `Cache-Control`。
  - 对 **`/admin`**（管理后台）可在反代层增加 **`Cache-Control: no-cache, private, must-revalidate`**，降低浏览器与中间层长期持有旧 HTML 的概率（**不要**对 `/_next/static/` 强行 `no-store`，以免放弃 hash 文件的长缓存收益）。
- **CDN（Cloudflare / 阿里云 CDN 等）**
  - **HTML**（或 `/admin*`）与 **`/_next/static/*`** 使用 **不同缓存策略**：HTML **短 TTL / 不缓存 / 遵循源站 no-cache**；静态 **可长 TTL**。
  - 避免一条规则把 **整站** 设成「边缘缓存 1 年且忽略源站」。

### 2）发版后做一次刷新（Purge）

- 执行 **`release.sh`** 或 `docker compose ... up -d --build` 且 **`web` 已 healthy** 后，若域名前还有 **CDN**：在控制台对以下路径做一次 **刷新 / Purge**（以厂商文档为准）：
  - 至少：**`/admin/*`**、**`/`**（或你实际入口路径）；
  - 若仍见旧前端：再对 **`/_next/static/*`** 做 Purge（会短时间增加回源，但能立刻对齐新 chunk）。
- **自检**：`curl -I https://你的域名/admin/usage` 看 `cache-control`、`age`、`cf-cache-status` 等；与 **`curl -I http://127.0.0.1:3000/admin/usage`** 对照，确认公网与源站一致。

### 3）缓存分层（推荐）

| 资源类型 | 建议 |
|---------|------|
| `/_next/static/*`（文件名含 hash） | **长 TTL + immutable**（与 Next 默认一致；CDN 对齐源站即可） |
| HTML、`/admin/*`、强个性化页面 | **短 TTL** 或 **`no-cache`**；发版后 **CDN Purge** |
| 同源 API（若经同一主机名） | **不缓存** 或极短 TTL |

### 4）阿里云 CDN：`prestoai.cn` 源站已是新版、域名仍显示旧版

典型原因：**边缘节点仍命中旧 HTML**（或旧 `/_next/static/*`），与 ECS 上 Docker Web 是否最新无关。

#### A. 先确认「旧」发生在哪一层（在任意能出网的机器执行）

1. **直连源站 Web（须在能访问 ECS 内网或本机的环境；生产多为 SSH 上 ECS）**  
   `curl -sI http://127.0.0.1:3000/ | tr -d '\r' | grep -iE 'cache-control|http/'`  
   应看到 **`no-store` / `no-cache`** 一类（与当前 Next + Nginx 策略一致），且页面内容应为新版本。

2. **经公网域名（走 CDN）**  
   `curl -sI https://prestoai.cn/ | tr -d '\r' | grep -iE 'cache-control|age|x-cache|via|server'`  
   若出现 **`Age` 很大**、或 **`X-Cache: HIT`**（具体头名因阿里云产品略有差异）、或 **`Cache-Control` 与步骤 1 明显不一致**，基本可判定为 **CDN / 中间代理缓存**。

3. **若步骤 1 已是旧内容**：先 **`bash release.sh`** 或 `docker compose ... up -d --build`，确认 `web` 容器为新镜像后再测步骤 1。

#### B. 阿里云 CDN 控制台（必做：发版后刷新）

1. 登录 [阿里云 CDN 控制台](https://cdn.console.aliyun.com/) → **域名管理** → 选中 **`prestoai.cn`**（若用户实际访问 **`www.prestoai.cn`**，两个加速域名要**分别**处理）。
2. 左侧 **「刷新预热」**（或 **缓存刷新**）→ **URL 刷新**。
3. **建议至少刷新以下 URL**（按你站点是否同时存在 apex / `www` 复制；**目录刷新**时 URL **必须以 `/` 结尾**）：
   - `https://prestoai.cn/`
   - `https://prestoai.cn/admin/`（若使用管理端）
   - 若对外还暴露 **`www.prestoai.cn`**：同样各加一条根路径与 `/admin/`。
4. 刷新后等待 **1～5 分钟**（视节点与任务队列），再用浏览器 **无痕窗口** 打开首页验证。若仍见**旧 JS/CSS 报错或白屏**，再补刷 **`https://prestoai.cn/_next/static/`**（目录刷新，会短时增加回源，慎用高峰期）。

#### C. 阿里云 CDN：缓存规则（减少「每次发版都要全站刷新」）

在 **域名管理** → 对应域名 → **缓存配置** → **缓存过期时间**（或「节点缓存规则」）：

- **对 HTML 文档路径**（如 `/`、`/admin`、`/notes` 等页面路由）：设为 **遵循源站**、或 **TTL 极短（如 60 秒）**、或 **不缓存**，且**不要**勾选「忽略源站 Cache-Control」类选项（若有）。
- **对 `/_next/static/`**：可 **长 TTL**（文件名含 hash，换版会换新 URL）。
- **对 `/api/`**：建议 **不缓存** 或 **遵循源站**（BFF 常为 `no-store`）。

避免一条「**整站 `/*` 缓存 30 天**」且不区分路径的规则，否则发版后极易长期看到旧 HTML。

#### D. ECS 上 Nginx（宝塔 / 自建）

- 若 **`location /`** 配置了 **`proxy_cache`** 或 **`expires 30d`** 等长过期：会把 **动态 HTML** 一并缓存，表现为 **本机 `curl 127.0.0.1` 新、经 Nginx 端口旧**。请改为 **仅对 `/_next/static/`** 等静态路径启用长缓存，**HTML 反代 location 不要**套全站 `proxy_cache`。详见上文「1）别让 Nginx…」与仓库 **`deploy/nginx-prestoai.cdn-cache.example.conf`**。
- 修改后执行：`sudo nginx -t && sudo nginx -s reload`（或宝塔内「保存并重载」）。

#### E. 发版后自动调用 CDN 刷新（可选）

在服务器 **`/opt/FYV/.env.ai-native`**（或你的 `APP_DIR`）中配置 **`ALIYUN_CDN_*`**，并在发布机安装 **`aliyun` CLI** 且 AK 具备刷新权限；`release.sh` 成功后会执行 **`scripts/aliyun-cdn-refresh.sh`**。变量说明与 **`prestoai.cn` 填写示例**见根目录 **`.env.ai-native.example`** 中「阿里云 CDN」注释块。

**示例配置**：仓库根目录 **`deploy/nginx-prestoai.cdn-cache.example.conf`**（注释块内为完整 `server` 片段，按需合并到宝塔或 `sites-available`，`nginx -t` 后 `reload`）。

#### F. 知识库 `/api/notes/ask*` 不经 CDN、直连源站（缓解网关 504）

同一主机名若 **CNAME 到阿里云 CDN**，则 **无法** 做到「仅 `/api/notes/ask` 绕 CDN、其余仍走 CDN」：边缘节点对整站域名统一接管。可行做法是 **第二个 DNS 名直连 ECS**（A/AAAA 到源 IP 或 SLB，**不要**再 CNAME 到 CDN），与主站共用同一套 Next 进程与证书。

1. **DNS**：例如新增 `origin-www.example.com` → 源站公网 IP（或内网 SLB 公网地址），**不**接入 CDN 加速域名。
2. **TLS / Nginx**：`server_name` 包含 `origin-www.example.com`，证书覆盖该主机名（ACME 多 SAN 或单独证书）。
3. **会话 Cookie**：登录态要被子域携带时，在 Web 环境设置 **`COOKIE_DOMAIN=.example.com`**（见 `.env.ai-native.example` 中 `COOKIE_DOMAIN`），使 `fym_session` 对 `www` 与 `origin-www` 均可见。
4. **前端（构建时注入）**：在 Web 构建环境设置 **`NEXT_PUBLIC_NOTES_ASK_BFF_ORIGIN=https://origin-www.example.com`**（无尾斜杠）。笔记页对 **`/api/notes/ask/hints`** 与 **`/api/notes/ask/stream`** 会改为请求该源站域名；未设置时仍走同源相对路径 `/api/...`（即仍经浏览器当前 host，可能为 CDN）。
5. **CORS**：页面在 `https://www.example.com`、API 在 `https://origin-www.example.com` 时为跨域，须设置 **`NEXT_PUBLIC_NOTES_ASK_CORS_ORIGINS`**（逗号分隔，与地址栏 Origin 完全一致，如 `https://www.example.com,https://example.com`）。`middleware` 仅对 **`/api/notes/ask*`** 在 Origin 命中白名单时返回 `Access-Control-Allow-Origin` 与 `Allow-Credentials`；fetch 使用 **`credentials: "include"`**（由 `notesAskFetchCredentials()` 处理）。
6. **安全**：`NEXT_PUBLIC_NOTES_ASK_CORS_ORIGINS` 仅列出自有站点，勿填 `*` 或与业务无关的第三方域。

实现参考：`apps/web/lib/notesAskBffOrigin.ts`、`apps/web/middleware.ts`（`NOTES_ASK_API_PREFIX`）。

7. **网关 504（Tengine/HTML 错误页）仍出现时**：说明 **Next 之前的某一跳** 在首字节或流式传输中断开。Next 侧 SSE 已不设上游 Abort 上限；须从外向内排查 **最短的超时**：

   | 位置 | 操作 |
   |------|------|
   | **`stream.*` 上 Nginx**（宝塔） | `location ^~ /api/notes/ask` 内 **`proxy_read_timeout` / `proxy_send_timeout` ≥300s**（建议 **600s**），**`proxy_buffering off`**。完整片段见 **`deploy/nginx-stream.prestoai-notes-only.example.conf`**。 |
   | **SLB / ALB**（公网入口在负载均衡时） | 控制台调大 **空闲超时 / 连接超时 / 数据传输超时**（产品文案不同，常见默认 **30～60s**）。 |
   | **CDN / DCDN / 全站加速** | 若 `stream` **误经 CDN**，调 **回源 HTTP 响应超时**；更稳妥是 **`stream` DNS 直连 ECS**，不要 CNAME 到静态 CDN。 |
   | **本机验证** | SSH 到源站：`curl -N -H 'Cookie: fym_session=…' -H 'Content-Type: application/json' -d '{…}' --max-time 120 https://127.0.0.1:3000/api/v1/notes/ask/stream`（编排器）与经 Nginx 的 `https://stream…/api/notes/ask/stream` 对比，判断 504 出在 Nginx 前还是后。 |

## 支付回调

- **入口（公网）**：支付平台或网关应 POST 至 **Next 对外域名** 下的 BFF 路径（由 `apps/web` 路由转发），由 BFF 将**原始 body** 与 **`X-Payment-Signature`** 转发到编排器 **`POST /api/v1/webhooks/payment`**。
- **编排器**：实现 JSON 解析、**`PAYMENT_WEBHOOK_SECRET` 下 HMAC-SHA256(body)** 验签、投递审计表、订单/订阅字段归一及幂等处理；支付宝电脑网站支付异步通知为 **`POST /api/v1/webhooks/alipay`**（`application/x-www-form-urlencoded`，RSA2 验签，见 `alipay_page_pay`）。生产请在编排器设置 **`ALIPAY_NOTIFY_URL`** 与开放平台填写的异步通知 URL **逐字一致**（须公网 HTTPS），例如主域为 `www` 时 **`https://www.prestoai.cn/api/webhooks/alipay`**；仅 apex 时改用 `https://prestoai.cn/api/webhooks/alipay`。由 Next BFF 原样转发 body 至编排器。
- 配置示例见 `.env.ai-native.example` 中 `PAYMENT_WEBHOOK_SECRET` / `ALIPAY_*`。本地联调可临时 `PAYMENT_WEBHOOK_ALLOW_UNSIGNED=1`，**不得用于生产**。

## 媒体 Worker 与播客队列

- **`podcast_generate` / `podcast`** 任务入 **Redis `media` 队列**，须由 **`media-worker`**（`workers/media-worker/worker.py`，与编排器**相同 `REDIS_URL`**）或编排器内嵌的 **RQ SimpleWorker** 消费。
- **本机只跑 `scripts/dev-api.sh` / `make dev-api`（仅 uvicorn）**：在 **`FYV_PRODUCTION` 未开启**时，编排器默认 **`ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER` 视为开启**，在进程内启动内嵌 `media` 消费者，播客可出队。若本机 `.env` 设了 **`FYV_PRODUCTION=1`** 又未起独立 `media-worker`，请显式设 **`ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER=1`**，或改用 **`make dev`**。
- **Docker Compose**：`orchestrator` 服务环境变量 **`ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER=0`**，由独立 **`media-worker`** 消费队列，避免双消费与 API 同进程争用 CPU。
- 全栈本机开发请用 **`make dev`**（默认起 `ai` + `media` worker）。**`SKIP_DEV_WORKERS=1 make dev`** 时依赖上述**内嵌**逻辑（非生产）或须自行起 worker。
- **其它 `job_type`**（非播客）在媒体 Worker 内当前多为占位逻辑。生产若需禁止「假成功」，可设 **`MEDIA_WORKER_FAIL_ON_NON_PODCAST=1`**。
- **排查**：**`GET /health`** 查看 `queues.media_pending`、`embedded_media_rq_worker`；任务长期 `queued` 时检查 **`media-worker`** 与 Redis。
