"""ffmpeg volumedetect：用于听感质检（均值/峰值电平）。"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

_MEAN = re.compile(r"mean_volume:\s*([-\d.]+)\s*dB")
_MAX = re.compile(r"max_volume:\s*([-\d.]+)\s*dB")


def analyze_loudness_from_file(path: Path, *, timeout_sec: int = 300) -> dict[str, float | str | None]:
    """
    解析 ffmpeg volumedetect 输出；失败时返回带 error 字段的字典。
    """
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        return {"error": "volumedetect_timeout"}
    text = (r.stderr or "") + "\n" + (r.stdout or "")
    mm = _MEAN.search(text)
    mx = _MAX.search(text)
    out: dict[str, float | str | None] = {}
    if mm:
        try:
            out["mean_volume_db"] = float(mm.group(1))
        except ValueError:
            out["mean_volume_db"] = None
    if mx:
        try:
            out["max_volume_db"] = float(mx.group(1))
        except ValueError:
            out["max_volume_db"] = None
    if not out.get("mean_volume_db") and not out.get("max_volume_db"):
        out["error"] = "volumedetect_parse_failed"
    logger.info("loudness_qc path=%s keys=%s", path.name, list(out.keys()))
    return out
