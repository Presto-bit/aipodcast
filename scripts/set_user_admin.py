#!/usr/bin/env python3
"""
将指定手机号的用户设为管理员（直接改 legacy_backend/data/users.json）。

用法:
  python3 scripts/set_user_admin.py 13800138000
  python3 scripts/set_user_admin.py 13800138000 13900139000

需在项目根目录执行；若使用自定义 FYV_DATA_DIR，请先确认目标 users.json 路径。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ORCH = os.path.join(ROOT, "services", "orchestrator")
if _ORCH not in sys.path:
    sys.path.insert(0, _ORCH)
from app.fyv_shared.config import DATA_DIR  # noqa: E402

USERS_PATH = os.path.join(DATA_DIR, "users.json")


def _atomic_write_json(path: str, data: dict) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".users.", suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_f:
            json.dump(data, tmp_f, ensure_ascii=False, indent=2)
            tmp_f.write("\n")
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def main() -> int:
    phones = [p.strip() for p in sys.argv[1:] if p.strip()]
    if not phones:
        print("用法: python3 scripts/set_user_admin.py <手机号> [手机号...]", file=sys.stderr)
        return 2

    if not os.path.isfile(USERS_PATH):
        print(f"未找到 {USERS_PATH}", file=sys.stderr)
        return 1

    try:
        with open(USERS_PATH, "r", encoding="utf-8") as f:
            users = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"users.json JSON 无效: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"无法读取 {USERS_PATH}: {exc}", file=sys.stderr)
        return 1

    if not isinstance(users, dict):
        print("users.json 格式错误", file=sys.stderr)
        return 1

    for p in phones:
        if p not in users:
            print(f"跳过（不存在）: {p}", file=sys.stderr)
            continue
        if not isinstance(users[p], dict):
            continue
        users[p]["role"] = "admin"
        print(f"已设为管理员: {p}")

    try:
        _atomic_write_json(USERS_PATH, users)
    except OSError as exc:
        print(f"写入 {USERS_PATH} 失败: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
