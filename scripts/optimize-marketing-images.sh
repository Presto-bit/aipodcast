#!/usr/bin/env bash
# 将 apps/web/public/marketing 下 PNG 转为按展示宽度缩放的 WebP（需 cwebp：brew install webp）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="$ROOT/apps/web/public/marketing"

if ! command -v cwebp >/dev/null 2>&1; then
  echo "cwebp not found. Install: brew install webp" >&2
  exit 1
fi

encode() {
  local src="$1" max_w="$2" dest="$3"
  local tmp
  tmp="$(mktemp -t marketing-img.XXXXXX.png)"
  sips -Z "$max_w" "$src" --out "$tmp" >/dev/null
  cwebp -quiet -q 82 "$tmp" -o "$dest"
  rm -f "$tmp"
  echo "$(basename "$dest"): $(wc -c <"$dest" | tr -d ' ') bytes (max width ${max_w}px)"
}

encode "$PUB/hero.png" 1200 "$PUB/hero.webp"
encode "$PUB/scenario-cards.png" 960 "$PUB/scenario-cards.webp"

for name in sources citation formats podcast; do
  encode "$PUB/features/${name}.png" 840 "$PUB/features/${name}.webp"
done

echo "Done."
