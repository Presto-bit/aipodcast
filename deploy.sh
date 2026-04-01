#!/usr/bin/env bash
# 转交至 deploy/one_click_deploy.sh（请在项目根目录执行: sudo bash deploy.sh）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
WRAPPER="$ROOT/deploy/one_click_deploy.sh"
[[ -f "$WRAPPER" ]] || { echo "未找到 $WRAPPER" >&2; exit 1; }
exec bash "$WRAPPER" "$@"
