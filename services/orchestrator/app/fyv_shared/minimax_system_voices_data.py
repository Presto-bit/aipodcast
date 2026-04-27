"""Minimax 系统音色列表。数据在 `minimax_system_voices.json`（与旧版 Python 大表同源）。

更新流程：由 `scripts/minimax_voice_table.md` 经 `scripts/md_table_to_default_voices.py` 等生成后，
将结果写入/覆盖 `minimax_system_voices.json`；勿手改大段 JSON。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

_JSON_PATH = Path(__file__).with_name("minimax_system_voices.json")


@lru_cache(maxsize=1)
def load_system_voices_raw() -> dict[str, Any]:
    """按需读取 JSON 并进程内缓存；避免 import 时加载整表进内存。"""
    if not _JSON_PATH.is_file():
        return {}
    try:
        with _JSON_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}
    return cast(dict[str, Any], data) if isinstance(data, dict) else {}
