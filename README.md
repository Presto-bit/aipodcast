# Presto AI Podcast（FindingYourVoice）

一个面向内容创作的 AI 工作台：支持「笔记出播客」「AI 播客」「文本转语音」，并提供音色管理、作品归档、草稿管理与登录鉴权能力。

---

## 功能概览

- **笔记出播客**：基于已选笔记生成播客或文章（支持文章模式与播客模式）。
- **AI 播客**：输入话题 / 网页 / PDF，生成双人播客脚本与音频。
- **文本转语音（TTS）**：文本润色 + 语音合成，支持下载与作品沉淀。
- **音色管理**：合并「你的声音」与「音色管理」为统一页面，支持折叠管理。
- **我的作品**：整合三类产物（笔记出播客 / AI 播客 / TTS），支持文件夹、筛选、移动、下载。
- **登录鉴权（手机号+密码）**：
  - 注册 / 登录
  - 忘记密码 / 重置密码
  - 登录限流（防暴力破解）
  - 用户数据 SQLite 持久化

---

## 技术栈

- **前端**：React（CRA）
- **后端**：Flask
- **鉴权存储**：SQLite（`backend/backend/outputs/auth.db`）
- **其它**：SSE 流式返回、本地文件存储、音频处理（`ffmpeg`）

---

## 目录结构（关键）

```text
minimax_aipodcast/
├─ backend/
│  ├─ app.py
│  ├─ auth_service.py
│  ├─ minimax_client.py
│  └─ backend/
│     ├─ uploads/
│     └─ outputs/
│        └─ auth.db
├─ frontend/
│  ├─ src/
│  └─ build/                # 前端构建产物
├─ deploy/
│  ├─ one_click_deploy.sh
│  ├─ deploy.env.example
│  └─ aipodcast.env.example
└─ deploy.sh                # 一键部署入口
```

---

## 本地开发

### 1) 环境要求

- Python 3.11 / 3.12（推荐 3.12）
- Node.js 18+
- npm
- ffmpeg

### 2) 安装依赖

在项目根目录：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

前端：

```bash
cd frontend
npm install
```

### 3) 启动服务

后端（新终端）：

```bash
cd /path/to/minimax_aipodcast
./backend/run.sh
```

前端（新终端）：

```bash
cd /path/to/minimax_aipodcast/frontend
npm start
```

默认访问：

- 前端：`http://localhost:3000`
- 后端：`http://127.0.0.1:5001`

---

## 登录鉴权配置

通过环境变量控制：

```bash
# 开启登录体系
export FYV_AUTH_ENABLED=1

# 是否要求注册邀请码（默认 0）
export FYV_REQUIRE_INVITE=0

# 邀请码内容（仅 FYV_REQUIRE_INVITE=1 时生效）
export FYV_ADMIN_INVITE_CODE=fym-admin-2025

# 重置密码调试模式（1 时 forgot_password 会返回 debug_reset_code）
export FYV_AUTH_DEBUG_RESET_CODE=0
```

### 鉴权数据存储位置

- SQLite 数据库：`backend/backend/outputs/auth.db`
- 主要表：
  - `users`
  - `sessions`
  - `auth_rate_limits`
  - `password_resets`

---

## 一键部署（阿里云 ECS 推荐）

### 0) 阿里云侧准备

- 安全组放行：`22`（SSH）、`80`（HTTP）、`443`（HTTPS 可选）
- 建议使用普通用户（如 `ubuntu` / `ecs-user`），不要把项目放在 `/root`

### 1) 服务器上准备代码

```bash
cd /opt
sudo git clone https://github.com/Presto-bit/aipodcast.git
sudo chown -R $USER:$USER /opt/aipodcast
cd /opt/aipodcast
```

### 2) 交互式一键部署（推荐首跑）

```bash
sudo bash deploy.sh
```

按提示填写：

- `APP_USER`：运行后端与前端构建的 Linux 用户（非 root）
- `SERVER_NAME`：域名或公网 IP（不确定可填 `_`）
- `DEPLOY_ROOT`：项目路径（示例 `/opt/aipodcast`）

### 3) 非交互部署（适合重复发布）

```bash
cp deploy/deploy.env.example deploy/deploy.env
# 编辑 deploy/deploy.env
sudo bash deploy.sh --yes
```

### 3.5) 推荐：给后端单独环境文件（阿里云生产）

```bash
sudo cp deploy/aipodcast.env.example /etc/default/aipodcast
sudo nano /etc/default/aipodcast
sudo chmod 600 /etc/default/aipodcast
sudo bash deploy.sh --yes --backend-env-file /etc/default/aipodcast
```

说明：

- `/etc/default/aipodcast` 会被 systemd 作为 `EnvironmentFile` 载入
- 推荐把 `MINIMAX_API_KEY` 等敏感配置放在这里，不写入仓库

常用参数：

```bash
# 跳过 git pull（网络或 SSH 不稳定时）
sudo bash deploy.sh --yes --no-git-pull

# 指定后端环境变量文件给 systemd
sudo bash deploy.sh --yes --backend-env-file /etc/default/aipodcast
```

### 4) 部署后验证

```bash
systemctl status aipodcast-backend --no-pager
curl -s http://127.0.0.1:5001/api/ping
curl -I http://127.0.0.1/
```

若异常，查看日志：

```bash
journalctl -u aipodcast-backend -n 120 --no-pager
```

---

## 发布前检查清单（建议）

- [ ] `.gitignore` 已忽略 `outputs` / `uploads` / `node_modules`
- [ ] 不提交 `.env`、密钥、音频产物、数据库
- [ ] 前端 `npm run build` 通过
- [ ] 后端 `python3 -m py_compile backend/app.py backend/auth_service.py` 通过
- [ ] `health` 与 `auth` 基础接口可用
- [ ] 生产环境使用 `systemd + nginx`（不要用 Flask dev server 常驻）

---

## 常见问题

### 1) `git push` 提示 non-fast-forward

先拉远程再推：

```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

### 2) 部署时报 `Permission denied: /root/...`

不要把项目放在 `/root` 下给普通用户运行。建议放到 `/opt/aipodcast` 并修正所属用户。

### 3) 5001 端口被占用

检查旧进程并重启服务，避免“新代码没生效但接口仍在跑旧版本”。

---

## 免责声明

请勿将敏感密钥硬编码到仓库。生产环境请使用环境变量或密钥管理服务。

