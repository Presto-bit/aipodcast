#!/usr/bin/env bash
# 转交至 deploy/one_click_deploy.sh（请在项目根目录执行: sudo bash deploy.sh）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/deploy/one_click_deploy.sh" "$@"
