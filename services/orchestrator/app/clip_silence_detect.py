"""ffmpeg silencedetect：输出静音区间（毫秒）。"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

_SILENCE_START = re.compile(r"silence_start:\s*([\d.]+)")
_SILENCE_END = re.compile(r"silence_end:\s*([\d.]+)")


def detect_silence_segments_from_file(
    path: Path,
    *,
    noise_db: float = -35.0,
    min_duration_sec: float = 0.4,
    timeout_sec: int = 600,
) -> list[dict[str, int]]:
    """
    返回 [{ "start_ms": int, "end_ms": int }, ...]（按时间升序）。
    """
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    filt = f"silencedetect=noise={noise_db}dB:d={min_duration_sec}"
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-nostats",
        "-i",
        str(path),
        "-af",
        filt,
        "-f",
        "null",
        "-",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffmpeg silencedetect 超时") from None
    text = (r.stderr or "") + "\n" + (r.stdout or "")
    events: list[tuple[str, float]] = []
    for line in text.splitlines():
        m1 = _SILENCE_START.search(line)
        if m1:
            events.append(("s", float(m1.group(1))))
        m2 = _SILENCE_END.search(line)
        if m2:
            events.append(("e", float(m2.group(1))))
    segs: list[dict[str, int]] = []
    open_s: float | None = None
    for kind, t in events:
        if kind == "s":
            open_s = t
        elif kind == "e" and open_s is not None and t > open_s:
            s_ms = max(0, int(open_s * 1000))
            e_ms = max(s_ms, int(t * 1000))
            if e_ms - s_ms >= int(min_duration_sec * 1000):
                segs.append({"start_ms": s_ms, "end_ms": e_ms})
            open_s = None
    segs.sort(key=lambda x: x["start_ms"])
    logger.info("silence_detect segments=%s path=%s", len(segs), path.name)
    return segs
