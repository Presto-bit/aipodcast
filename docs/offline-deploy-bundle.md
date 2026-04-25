# 离线部署打包清单（全面）

在 **能访问 Docker Hub、Debian apt、PyPI、npm** 的机器上准备好下列内容，再拷贝到 **无外网或受限** 的 ECS 上安装。按「层级」从简到繁可选。

---

## 层级 A：仅镜像 + 源码（构建时仍可能要 PyPI/npm）

| 内容 | 说明 |
|------|------|
| **Docker 镜像 tar** | `postgres:16-alpine`、`redis:7-alpine`、`minio/minio:latest`、`caddy:2-alpine`（`minio-https` 预签名 TLS 反代）、`node:20-alpine`；Python 侧用 **`aipodcast/python-ffmpeg:3.12-slim-amd64`**（`make build-offline-bases`）避免服务器 `apt-get ffmpeg`。 |
| **源码包** | 仓库根目录除 `.git`、`node_modules`、`.venv`、大体积 `legacy_backend/uploads|outputs|data` 外的全部文件；可用 `bash scripts/package-offline-bundle.sh` 生成 `dist/offline-deploy-*/aipodcast-source.tar.gz`。 |
| **环境文件** | `.env.ai-native` **不提交 Git**，在服务器从 `.env.ai-native.example` 复制并编辑；打包时单独拷贝或内网传递。 |

**ECS 上**：`docker load` → 解压源码 → 配置 `.env.ai-native`（含 `PYTHON_BASE_IMAGE=aipodcast/python-ffmpeg:3.12-slim-amd64`）→ `make up-offline`。  
若构建阶段 **pip / npm 仍失败**，继续准备层级 B、C。

---

## 层级 B：+ Python wheel（编排器 / Worker 构建不访问 PyPI）

| 内容 | 说明 |
|------|------|
| **`docker/offline-pip-wheels/*.whl`** | 在联网机执行 `bash scripts/package-offline-bundle.sh --pip-wheels`，或手动用 `linux/amd64` 的 `python:3.12-slim` 容器对 `services/orchestrator/requirements.txt` 执行 `pip download -d docker/offline-pip-wheels`。 |
| **与源码一起打 tar** | 使用脚本生成的 **`aipodcast-source-with-pip-wheels.tar.gz`**，或自行打包时 **包含** `docker/offline-pip-wheels/` 目录。 |

编排器与两个 Worker 的 Dockerfile 会在该目录下存在 **`.whl` 文件** 时自动 `pip install --no-index --find-links=...`。

---

## 层级 C：Next.js 构建不访问 npm（可选，最重）

| 内容 | 说明 |
|------|------|
| **全栈镜像一个 tar** | 在联网机仓库根目录：配置好 `.env.ai-native` 后执行 **`bash scripts/save-full-stack-tar.sh`** 或 **`make save-full-stack-tar`**，生成 `aipodcast-full-stack-amd64.tar`（内含 postgres/redis/minio + 四个业务镜像）。Apple Silicon 请先 **`export DOCKER_DEFAULT_PLATFORM=linux/amd64`**。 |
| **业务镜像固定名** | `aipodcast-orchestrator:latest`、`aipodcast-ai-worker:latest`、`aipodcast-media-worker:latest`、`aipodcast-web:latest`（标签可由 `.env.ai-native` 中 **`AIPODCAST_IMAGE_TAG`** 覆盖）。 |

**服务器上**：`docker load -i aipodcast-full-stack-amd64.tar` → 解压**同版本**源码 → 使用兼容的 `.env.ai-native` → **`docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native up -d`**（**不要**再加 `--build`，除非你要在服务器上改代码重建）。

适合 **完全隔离** 环境；升级需在联网机重新构建并重新 save。

---

## 建议一并携带/核对的路径（构建所需）

以下路径会被 **Dockerfile / compose** 使用，源码包中应存在（脚本已尽量排除无关大目录）：

- `docker-compose.ai-native.yml`
- `docker/python-ffmpeg-base.Dockerfile`、`docker/offline-pip-wheels/`（可选 wheel）
- `services/orchestrator/`（含 `Dockerfile`、`requirements.txt`、`app/`）
- `workers/ai-worker/`、`workers/media-worker/`
- `apps/web/`（无 `node_modules` 亦可，构建时会 `npm install`）
- `packages/shared-types/`
- `legacy_backend/`（目录结构；数据/上传默认被 tar 排除，运行时生成）
- `infra/postgres/init/`（数据库初始化 SQL）
- `scripts/docker-compose-offline.sh`、`scripts/build-offline-base-images.sh`、`scripts/package-offline-bundle.sh`
- `Makefile`、`.env.ai-native.example`
- `deploy/`（若使用 `deploy.sh`）

**不必**打进源码包（或应排除）：`.git`、`node_modules`、`apps/web/.next`、`.venv-ai-native`、`dist/`、本地 `.env.ai-native`、大文件上传目录。

---

## 一键生成分发目录

```bash
# 仅打源码 tar + 生成 docker save 示例脚本
bash scripts/package-offline-bundle.sh

# 同时下载 pip wheel 到 docker/offline-pip-wheels/，并再打一份含 wheel 的完整源码包
bash scripts/package-offline-bundle.sh --pip-wheels
```

输出在 **`dist/offline-deploy-<时间戳>/`**，内含 `MANIFEST.txt` 说明。

联网机上再执行该目录中的 **`docker-images-save.sh`**（或按其中说明自行 `docker pull` + `docker save`），得到镜像大文件，与源码 tar **分开传输**即可。

---

## 架构与变量提醒

- 镜像与 wheel 须匹配 **linux/amd64**（Apple Silicon 打包时 `docker pull --platform linux/amd64`）。Compose 已为各服务设置 **`platform: linux/amd64`**；`save-full-stack-tar.sh` 默认 **`DOCKER_DEFAULT_PLATFORM=linux/amd64`**。若 ECS 报 arm64/amd64 不匹配，说明 tar 内仍是 arm64，需在打包机删掉相关镜像后重新打包。
- 离线构建推荐 **`make up-offline`**（关闭 BuildKit，减少对 `registry-1.docker.io` 的 manifest 请求）；基础镜像须已 `docker load`。
- **MinIO** 官方为 `minio/minio`，不要用 `library/minio`；DaoCloud 等对 minio 常有限制，优先自有 tar 或 ACR。

---

## 与 ACR / 在线拉取的关系

能稳定访问镜像仓库时，可在 `.env.ai-native` 用 `POSTGRES_IMAGE` 等指向 ACR，无需 tar 镜像；**wheel 与预构建业务镜像**仍可按层级 B、C 使用。
