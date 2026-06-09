"""剪辑导出选项：请求体验证与默认值（与前端 export_options 结构对齐）。"""

from __future__ import annotations

from typing import Any


def sanitize_clip_export_options(raw: Any) -> dict[str, Any]:
    """
    将客户端 JSON 规范为安全子集；当前仅保留导出音质（lame_q）。
    loudnorm 仅在用户「一键响度」修音时写入主素材，导出不再重复处理。
    """
    if not isinstance(raw, dict):
        raw = {}
    enc = raw.get("encoding") if isinstance(raw.get("encoding"), dict) else {}
    try:
        q = int(enc.get("lame_q", 2))
        q = max(0, min(9, q))
    except (TypeError, ValueError):
        q = 2
    return {"encoding": {"lame_q": q}}


def lame_q_from_export_options(raw: Any) -> int:
    """从工程 export_options 读取 LAME VBR 质量（0 最高，2 推荐默认）。"""
    return int(sanitize_clip_export_options(raw).get("encoding", {}).get("lame_q", 2))
