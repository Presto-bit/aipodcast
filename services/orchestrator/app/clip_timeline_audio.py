"""方案三：按 audio_source_segments 顺序在导出等场景临时拼成一条字节时间轴。"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

from .clip_audio_merge import merge_audio_files_layered
from .object_store import download_object_to_path

logger = logging.getLogger(__name__)


def concat_ordered_source_segments_to_bytes(segments: list[dict[str, Any]]) -> bytes:
    """
    将有序分段（每项含 key）合并为单一音频字节流（与 clip merge 相同编码策略）。
    单段时亦走合并逻辑以保证格式一致。
    """
    if not segments:
        raise RuntimeError("无分段可拼接")
    with tempfile.TemporaryDirectory(prefix="fyv_clip_export_concat_") as td:
        td_path = Path(td)
        paths: list[Path] = []
        for i, seg in enumerate(segments):
            key = str(seg.get("key") or "").strip()
            if not key:
                continue
            ext = Path(str(seg.get("filename") or "seg.bin")).suffix or ".bin"
            p = td_path / f"seg_{i:03d}{ext}"
            download_object_to_path(key, p)
            paths.append(p)
        if not paths:
            raise RuntimeError("分段 key 无效")
        merged_path, _mime, _fn = merge_audio_files_layered(paths, td_path)
        return merged_path.read_bytes()
