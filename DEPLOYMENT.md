# 云服务器部署指南

## 一键部署（推荐，Ubuntu / Debian）

在服务器上进入**项目根目录**（含 `frontend`、`backend`、`requirements.txt`），执行：

```bash
sudo bash deploy.sh
```

按提示输入：

- 运行服务的 **Linux 用户名**（不要用 `root`，例如 `ubuntu`）
- **Nginx server_name**（填公网 IP 或域名；不确定可填 `_`）
- **项目根目录**（默认为当前仓库路径）

脚本会：安装/检查依赖（nginx、Node、ffmpeg、Python venv）、`pip install -r requirements.txt`、生产构建前端、注册 **systemd** 服务 `aipodcast-backend`、写入 **Nginx** 站点并 `reload`。

**完全非交互**（适合重复发布）：

```bash
cp deploy/deploy.env.example deploy/deploy.env
# 编辑 deploy/deploy.env 后：
sudo bash deploy.sh --yes
```

或一行参数：

```bash
sudo bash deploy.sh --yes --user ubuntu --server-name 你的IP或域名 --root /opt/minimax_aipodcast
```

常用排查：

```bash
curl -s http://127.0.0.1:5001/api/ping
systemctl status aipodcast-backend
journalctl -u aipodcast-backend -n 80 --no-pager
sudo nginx -t && sudo systemctl reload nginx
```

浏览器访问：`http://<公网IP或域名>`（安全组需放行 **80** / **443**）。

---

## 手动分步部署（非 Debian 或需自定义时）

安装 Git、Python 3.12/3.11 venv、Node LTS、Nginx、ffmpeg → 克隆代码 → 在项目根创建 `.venv` 并 `pip install -r requirements.txt` → 在 `frontend` 设置 `REACT_APP_API_URL=` 后 `npm run build` → 在 `backend` 运行 `app.py`（监听 `5001`）→ Nginx 将 `/api/`、`/download/`、`/static/`、`/health` 反代到本机 `5001`，`root` 指向 `frontend/build`。
