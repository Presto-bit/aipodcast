#!/usr/bin/env bash
# 可选：发版成功后调用阿里云 CDN RefreshObjectCaches。
# 依赖：已安装并可用 aliyun CLI（https://github.com/aliyun/aliyun-cli ）
# 文档：https://help.aliyun.com/zh/cdn/api-refreshobjectcaches
#
# 用法：
#   bash scripts/aliyun-cdn-refresh.sh [path/to/.env.ai-native]
# 未启用或缺条件时退出 0；启用但 aliyun 失败时退出 1。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.ai-native}"

parse_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="${raw%%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    local k="${BASH_REMATCH[1]}" v="${BASH_REMATCH[2]}"
    case "$k" in
      ALIBABA_CLOUD_ACCESS_KEY_ID | ALIBABA_CLOUD_ACCESS_KEY_SECRET | ALIYUN_ACCESS_KEY_ID | ALIYUN_ACCESS_KEY_SECRET | ALIYUN_CDN_REFRESH_ON_RELEASE | ALIYUN_CDN_REFRESH_URLS | ALIYUN_CDN_REFRESH_OBJECT_TYPE)
        [[ -n "${!k:-}" ]] && continue
        v="${v#"${v%%[![:space:]]*}"}"
        v="${v%"${v##*[![:space:]]}"}"
        v="${v#\"}"
        v="${v%\"}"
        v="${v#\'}"
        v="${v%\'}"
        eval "$(printf "export %q=%q" "$k" "$v")"
        ;;
    esac
  done <"$file"
}

parse_env_file "$ENV_FILE"

[[ "${ALIYUN_CDN_REFRESH_ON_RELEASE:-}" == "1" ]] || exit 0

AK="${ALIBABA_CLOUD_ACCESS_KEY_ID:-${ALIYUN_ACCESS_KEY_ID:-}}"
SK="${ALIBABA_CLOUD_ACCESS_KEY_SECRET:-${ALIYUN_ACCESS_KEY_SECRET:-}}"
if [[ -z "$AK" || -z "$SK" ]]; then
  echo "[aliyun-cdn-refresh] 已启用 ALIYUN_CDN_REFRESH_ON_RELEASE=1 但未配置 AccessKey（ALIBABA_CLOUD_ACCESS_KEY_* 或 ALIYUN_ACCESS_KEY_*）" >&2
  exit 1
fi

URLS="${ALIYUN_CDN_REFRESH_URLS:-}"
if [[ -z "$URLS" ]]; then
  echo "[aliyun-cdn-refresh] 已启用刷新但未设置 ALIYUN_CDN_REFRESH_URLS（逗号分隔的完整 URL）" >&2
  exit 1
fi

# 按用户配置的 URL 推导 https://host/_next/static/ 并去重追加，减少发版后旧 chunk 仍命中 CDN 的概率
cdn_join_refresh_urls() {
  local input="$1"
  local seen="|"
  local -a out=()
  local raw u origin
  local -a base_parts=()
  IFS=',' read -ra base_parts <<<"$input" || true
  for raw in "${base_parts[@]}"; do
    u="${raw#"${raw%%[![:space:]]*}"}"
    u="${u%"${u##*[![:space:]]}"}"
    [[ -z "$u" ]] && continue
    case "$seen" in *"|${u}|"*) ;; *)
      seen+="${u}|"
      out+=("$u")
      ;;
    esac
  done
  for raw in "${base_parts[@]}"; do
    u="${raw#"${raw%%[![:space:]]*}"}"
    u="${u%"${u##*[![:space:]]}"}"
    [[ -z "$u" ]] && continue
    if [[ "$u" =~ ^(https?://[^/?#]+) ]]; then
      origin="${BASH_REMATCH[1]}/_next/static/"
      case "$seen" in *"|${origin}|"*) ;; *)
        seen+="${origin}|"
        out+=("$origin")
        ;;
      esac
    fi
  done
  local IFS=,
  printf '%s' "${out[*]}"
}

if ! command -v aliyun >/dev/null 2>&1; then
  echo "[aliyun-cdn-refresh] 未找到 aliyun 命令，请安装阿里云 CLI：https://github.com/aliyun/aliyun-cli" >&2
  exit 1
fi

export ALIBABA_CLOUD_ACCESS_KEY_ID="$AK"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="$SK"

OT="${ALIYUN_CDN_REFRESH_OBJECT_TYPE:-Directory}"
# Directory：目录 URL 须以 / 结尾；File：单文件完整 URL。

REFRESH_CSV="$(cdn_join_refresh_urls "$URLS")"
IFS=',' read -ra PARTS <<<"$REFRESH_CSV" || true
echo "[aliyun-cdn-refresh] 共 ${#PARTS[@]} 条刷新路径（在 ALIYUN_CDN_REFRESH_URLS 基础上自动追加各源站 /_next/static/）" >&2
for raw in "${PARTS[@]}"; do
  u="${raw#"${raw%%[![:space:]]*}"}"
  u="${u%"${u##*[![:space:]]}"}"
  [[ -z "$u" ]] && continue
  echo "[aliyun-cdn-refresh] RefreshObjectCaches --ObjectType $OT --ObjectPath $u" >&2
  aliyun cdn RefreshObjectCaches --ObjectPath "$u" --ObjectType "$OT"
done

echo "[aliyun-cdn-refresh] 完成" >&2
