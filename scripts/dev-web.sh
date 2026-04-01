#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d "apps/web" ]]; then
  echo "未找到 apps/web 目录，请在仓库根目录执行。" >&2
  exit 1
fi
if [[ ! -x "apps/web/node_modules/.bin/next" ]]; then
  echo "未找到 apps/web/node_modules/.bin/next。" >&2
  echo "请在仓库根目录执行一次: npm install" >&2
  echo "（会安装根目录 concurrently 与 apps/web 的 Next.js 等依赖）" >&2
  exit 127
fi
exec npm run dev --prefix apps/web
