"""根据词级时间轴与排除列表，用 ffmpeg 从原始音频导出剪辑后 MP3。"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _merge_segments(words: list[dict[str, Any]], gap_ms: int) -> list[tuple[int, int]]:
    segs: list[tuple[int, int]] = []
    for w in words:
        try:
            s = int(w.get("s_ms", 0))
            e = int(w.get("e_ms", s))
        except (TypeError, ValueError):
            continue
        if e <= s:
            continue
        if not segs:
            segs.append((s, e))
            continue
        ls, le = segs[-1]
        if s - le <= gap_ms:
            segs[-1] = (ls, max(le, e))
        else:
            segs.append((s, e))
    return segs


def export_clip_mp3_from_bytes(
    *,
    audio_bytes: bytes,
    normalized: dict[str, Any],
    excluded_word_ids: set[str],
    merge_gap_ms: int = 120,
) -> bytes:
    """
    将未排除的词按时间合并后切段再 concat 为单轨 MP3。
    依赖系统 PATH 中的 ffmpeg。
    """
    words = normalized.get("words") if isinstance(normalized.get("words"), list) else []
    kept: list[dict[str, Any]] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        wid = str(w.get("id") or "").strip()
        if not wid or wid in excluded_word_ids:
            continue
        kept.append(w)
    kept.sort(key=lambda x: int(x.get("s_ms", 0) or 0))
    segs = _merge_segments(kept, gap_ms=max(0, int(merge_gap_ms)))
    if not segs:
        raise RuntimeError("没有可导出的语音片段（可能已删除全部词）")

    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.TemporaryDirectory(prefix="fyv_clip_export_") as td:
        td_path = Path(td)
        src = td_path / "source.bin"
        src.write_bytes(audio_bytes)
        # 让 ffmpeg 自探测格式
        inp = str(src)
        parts: list[Path] = []
        for i, (s_ms, e_ms) in enumerate(segs):
            dur_ms = max(50, e_ms - s_ms)
            part = td_path / f"p{i:05d}.mp3"
            cmd = [
                ffmpeg_bin,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{s_ms / 1000.0:.4f}",
                "-i",
                inp,
                "-t",
                f"{dur_ms / 1000.0:.4f}",
                "-vn",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "4",
                str(part),
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=600)
            except subprocess.CalledProcessError as e:
                err = (e.stderr or b"").decode("utf-8", errors="replace")[:800]
                logger.warning("ffmpeg segment failed: %s", err)
                raise RuntimeError(f"ffmpeg 切段失败: {err}") from e
            if not part.is_file() or part.stat().st_size < 32:
                raise RuntimeError("ffmpeg 未生成有效分段文件")
            parts.append(part)

        list_file = td_path / "concat.txt"
        lines = "\n".join([f"file '{p.name}'" for p in parts])
        list_file.write_text(lines + "\n", encoding="utf-8")
        out_mp3 = td_path / "out.mp3"
        cmd2 = [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(out_mp3),
        ]
        try:
            subprocess.run(cmd2, check=True, cwd=str(td_path), capture_output=True, timeout=600)
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"ffmpeg 拼接失败: {err}") from e
        if not out_mp3.is_file():
            raise RuntimeError("导出文件缺失")
        return out_mp3.read_bytes()
