#!/usr/bin/env python3
"""
清理 legacy_backend/outputs 中可再生成产物，保留结构占位与非目标文件。

默认只删除超过 7 天的文件；支持 --dry-run 预览。
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path


ALLOWED_SUFFIXES = {
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".epub",
    ".txt",
    ".json",
}

ALLOWED_PREFIXES = (
    "podcast_",
    "preview_",
    "progressive_",
    "script_",
    "cover_",
    "intro_",
    "sentence_",
    "note_",
)

KEEP_FILES = {".gitkeep"}


def should_delete(path: Path, min_age_sec: int) -> bool:
    if not path.is_file():
        return False
    name = path.name
    if name in KEEP_FILES:
        return False
    if path.suffix.lower() not in ALLOWED_SUFFIXES:
        return False
    if not any(name.startswith(p) for p in ALLOWED_PREFIXES):
        return False
    age = max(0, int(time.time() - path.stat().st_mtime))
    return age >= min_age_sec


def main() -> int:
    ap = argparse.ArgumentParser(description="Cleanup generated files in legacy_backend/outputs")
    ap.add_argument("--days", type=int, default=7, help="仅清理超过 N 天的文件（默认 7）")
    ap.add_argument("--dry-run", action="store_true", help="预览模式，不删除")
    ap.add_argument(
        "--outputs-dir",
        default=os.path.join(os.path.dirname(os.path.dirname(__file__)), "legacy_backend", "outputs"),
        help="输出目录（默认 legacy_backend/outputs）",
    )
    args = ap.parse_args()

    outputs_dir = Path(args.outputs_dir).resolve()
    if not outputs_dir.exists():
        print(f"目录不存在：{outputs_dir}")
        return 0

    min_age_sec = max(0, int(args.days)) * 86400
    targets = [p for p in outputs_dir.rglob("*") if should_delete(p, min_age_sec)]
    targets.sort(key=lambda p: str(p))

    if not targets:
        print("没有匹配到可清理文件。")
        return 0

    total_size = sum(p.stat().st_size for p in targets)
    for p in targets:
        rel = p.relative_to(outputs_dir)
        print(f"{'DRY-RUN' if args.dry_run else 'DELETE '} {rel}")
        if not args.dry_run:
            try:
                p.unlink(missing_ok=True)
            except OSError as exc:
                print(f"删除失败 {rel}: {exc}", file=sys.stderr)
                return 1

    print(f"{'将清理' if args.dry_run else '已清理'} {len(targets)} 个文件，约 {total_size / (1024 * 1024):.2f} MiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
