#!/usr/bin/env bash
# 在联网机器上生成分发目录：源码包、pip wheels 清单说明、Docker 镜像 save 命令模板。
# 用法（仓库根目录）：
#   bash scripts/package-offline-bundle.sh
#   bash scripts/package-offline-bundle.sh --pip-wheels   # 下载 linux/amd64 wheel 到 docker/offline-pip-wheels/
# 详见 docs/offline-deploy-bundle.md
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_PIP=0
for arg in "$@"; do
  case "$arg" in
    --pip-wheels) WITH_PIP=1 ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${ROOT}/dist/offline-deploy-${STAMP}"
mkdir -p "$OUT"

# 1) 源码包（含 docker/offline-pip-wheels 内已下载的 wheel，不含 .git / node_modules）
SRC_TAR="${OUT}/aipodcast-source.tar.gz"
tar czvf "$SRC_TAR" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='apps/web/node_modules' \
  --exclude='apps/web/.next' \
  --exclude='.venv-ai-native' \
  --exclude='dist' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='legacy_backend/uploads/*' \
  --exclude='legacy_backend/outputs/*' \
  --exclude='legacy_backend/data/*' \
  --exclude='.env' \
  --exclude='.env.ai-native' \
  -C "$ROOT" \
  .

echo "已生成: $SRC_TAR"

# 2) 可选：pip wheels（与 ECS 一致用 linux/amd64）
if [[ "$WITH_PIP" == 1 ]]; then
  mkdir -p "${ROOT}/docker/offline-pip-wheels"
  docker run --rm --platform linux/amd64 \
    -v "${ROOT}/docker/offline-pip-wheels:/w" \
    -v "${ROOT}/services/orchestrator/requirements.txt:/r.txt:ro" \
    python:3.12-slim \
    sh -c "pip install --upgrade pip -q && pip download -r /r.txt -d /w"
  echo "已下载 wheel 到 docker/offline-pip-wheels/（已加入 .gitignore，勿提交）"
  # 再打一份含 wheel 的完整包
  SRC_FULL="${OUT}/aipodcast-source-with-pip-wheels.tar.gz"
  tar czvf "$SRC_FULL" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='apps/web/node_modules' \
    --exclude='apps/web/.next' \
    --exclude='.venv-ai-native' \
    --exclude='dist' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='legacy_backend/uploads/*' \
    --exclude='legacy_backend/outputs/*' \
    --exclude='legacy_backend/data/*' \
    --exclude='.env' \
    --exclude='.env.ai-native' \
    -C "$ROOT" \
    .
  echo "已生成: $SRC_FULL"
fi

# 3) 镜像列表与 save 模板
cat > "${OUT}/docker-images-save.sh" << 'EOSAVE'
#!/usr/bin/env bash
# 在联网机器上执行；Apple Silicon 请设置: export DOCKER_PLATFORM=linux/amd64
set -euo pipefail
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
docker pull --platform "$PLATFORM" postgres:16-alpine
docker pull --platform "$PLATFORM" redis:7-alpine
docker pull --platform "$PLATFORM" minio/minio:latest
docker pull --platform "$PLATFORM" node:20-alpine

IMAGES=(postgres:16-alpine redis:7-alpine minio/minio:latest node:20-alpine)
if docker image inspect aipodcast/python-ffmpeg:3.12-slim-amd64 >/dev/null 2>&1; then
  IMAGES+=("aipodcast/python-ffmpeg:3.12-slim-amd64")
else
  echo "提示: 未找到 aipodcast/python-ffmpeg:3.12-slim-amd64，将改用 python:3.12-slim（服务器构建可能需要 apt ffmpeg）" >&2
  docker pull --platform "$PLATFORM" python:3.12-slim
  IMAGES+=("python:3.12-slim")
fi

OUT_TAR="${1:-aipodcast-docker-images-amd64.tar}"
docker save -o "$OUT_TAR" "${IMAGES[@]}"
echo "已写入: $OUT_TAR"
EOSAVE
chmod +x "${OUT}/docker-images-save.sh"

cp "${ROOT}/docs/offline-deploy-bundle.md" "${OUT}/README-offline-bundle.md" 2>/dev/null || true

{
  echo "离线分发目录: $OUT"
  echo ""
  echo "包含:"
  echo "  - aipodcast-source.tar.gz  源码（解压后需 cp .env.ai-native.example .env.ai-native 并编辑）"
  [[ "$WITH_PIP" == 1 ]] && echo "  - aipodcast-source-with-pip-wheels.tar.gz  同上且含 docker/offline-pip-wheels/*.whl"
  echo "  - docker-images-save.sh    在联网机拉镜像并 docker save 的示例脚本"
  echo "  - README-offline-bundle.md 完整清单（若存在）"
  echo ""
  echo "服务器上顺序建议:"
  echo "  1. docker load -i <镜像tar>"
  echo "  2. tar xzf aipodcast-source*.tar.gz && cd <目录>"
  echo "  3. .env.ai-native 中 PYTHON_BASE_IMAGE=aipodcast/python-ffmpeg:3.12-slim-amd64（若已 save 该镜像）"
  echo "  4. make up-offline"
} | tee "${OUT}/MANIFEST.txt"

echo ""
echo "完成。请阅读 docs/offline-deploy-bundle.md"
