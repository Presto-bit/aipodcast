"""多段音频合并（ffmpeg），并校验火山/豆包录音识别产品相关限制。"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 与火山引擎录音识别产品常见上限对齐（时长/总大小），见文档示例：https://www.volcengine.com/docs/6561/1631584
VOLC_FLASH_MAX_DURATION_SEC = 2 * 3600
VOLC_FLASH_MAX_TOTAL_BYTES = 100 * 1024 * 1024


def clip_merge_limits() -> dict[str, Any]:
    return {
        "max_duration_sec": VOLC_FLASH_MAX_DURATION_SEC,
        "max_total_bytes": VOLC_FLASH_MAX_TOTAL_BYTES,
        "max_total_bytes_mb": round(VOLC_FLASH_MAX_TOTAL_BYTES / (1024 * 1024), 1),
        "max_duration_h": round(VOLC_FLASH_MAX_DURATION_SEC / 3600, 2),
    }


def ffprobe_first_audio_stream(path: Path) -> tuple[int, str]:
    """首个音频流的 (channels, channel_layout 小写)；失败则抛错。"""
    ffprobe_bin = shutil.which("ffprobe") or "ffprobe"
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=channels,channel_layout",
        "-of",
        "json",
        str(path),
    ]
    try:
        r = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or "").strip()[:600]
        raise RuntimeError(f"ffprobe 声道失败: {err}") from e
    try:
        data = json.loads(r.stdout or "{}")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"ffprobe JSON 无效: {(r.stdout or '')[:200]}") from e
    streams = data.get("streams")
    if not isinstance(streams, list) or not streams:
        raise RuntimeError("ffprobe 无音频流")
    s0 = streams[0] if isinstance(streams[0], dict) else {}
    try:
        n = int(s0.get("channels") or 1)
    except (TypeError, ValueError):
        n = 1
    layout = str(s0.get("channel_layout") or "").strip().lower()
    logger.info("ffprobe audio stream channels=%s layout=%s path=%s", n, layout, path.name)
    return max(1, n), layout


def ffprobe_audio_channels(path: Path) -> int:
    """返回用于「是否双轨访谈」判定的声道数：优先 JSON channels，并参考 channel_layout。"""
    n, layout = ffprobe_first_audio_stream(path)
    if n >= 2:
        return n
    # 部分编码/封装异常时 channels=1 但 layout 仍含 stereo
    if layout and ("stereo" in layout or "fl+fr" in layout or "dual" in layout):
        return max(n, 2)
    return n


def ffprobe_duration_sec(path: Path) -> float:
    """返回音频时长（秒），失败则抛错。"""
    ffprobe_bin = shutil.which("ffprobe") or "ffprobe"
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        r = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or "").strip()[:600]
        raise RuntimeError(f"ffprobe 失败: {err}") from e
    raw = (r.stdout or "").strip()
    if not raw:
        raise RuntimeError("ffprobe 未返回时长")
    try:
        return max(0.0, float(raw))
    except ValueError as e:
        raise RuntimeError(f"ffprobe 时长无效: {raw!r}") from e


def merge_audio_files_to_mp3(paths: list[Path], out_mp3: Path) -> None:
    """
    将多段音频合并为单轨 MP3（重编码，兼容不同格式）。
    paths 顺序即拼接顺序。
    """
    if not paths:
        raise RuntimeError("没有可合并的音频文件")
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    if len(paths) == 1:
        cmd = [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(paths[0]),
            "-vn",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "4",
            str(out_mp3),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"ffmpeg 单段转码失败: {err}") from e
        if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
            raise RuntimeError("ffmpeg 未生成有效 MP3")
        return

    cmd = [ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-y"]
    for p in paths:
        cmd.extend(["-i", str(p)])
    n = len(paths)
    parts = "".join(f"[{i}:a]" for i in range(n))
    filt = f"{parts}concat=n={n}:v=0:a=1[aout]"
    cmd.extend(
        [
            "-filter_complex",
            filt,
            "-map",
            "[aout]",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "4",
            str(out_mp3),
        ]
    )
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=7200)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"ffmpeg 多段合并失败: {err}") from e
    if not out_mp3.is_file() or out_mp3.stat().st_size < 32:
        raise RuntimeError("ffmpeg 合并后文件无效")


def validate_staging_segments_for_volc(*, segment_meta: list[dict[str, Any]], temp_paths: list[Path]) -> None:
    """segment_meta 与 temp_paths 一一对应；校验总大小与总时长。"""
    if len(segment_meta) != len(temp_paths):
        raise RuntimeError("内部错误：分段元数据与临时文件数量不一致")
    total_b = 0
    total_sec = 0.0
    for meta, p in zip(segment_meta, temp_paths, strict=True):
        try:
            sz = int(meta.get("size_bytes") or p.stat().st_size)
        except OSError as e:
            raise RuntimeError(f"无法读取分段大小: {e}") from e
        total_b += max(0, sz)
        total_sec += ffprobe_duration_sec(p)
    max_b = int(os.getenv("CLIP_MERGE_MAX_TOTAL_BYTES") or str(VOLC_FLASH_MAX_TOTAL_BYTES))
    max_sec = float(os.getenv("CLIP_MERGE_MAX_DURATION_SEC") or str(VOLC_FLASH_MAX_DURATION_SEC))
    if total_b > max_b:
        raise RuntimeError(
            f"多段合计大小约 {total_b / (1024 * 1024):.1f} MB，超过上限 {max_b / (1024 * 1024):.0f} MB（产品约 100MB）"
        )
    if total_sec > max_sec + 1.0:
        raise RuntimeError(
            f"多段合计时长约 {total_sec / 60:.1f} 分钟，超过上限 {max_sec / 3600:.1f} 小时（产品常见 ≤2 小时）"
        )
