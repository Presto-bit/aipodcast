"""
pydub 通过 PATH 查找 ffmpeg/ffprobe（见 pydub.utils.which / get_prober_name）。
在 macOS 上从非登录 shell 启动时常见缺少 /opt/homebrew/bin，导致
[Errno 2] No such file or directory: 'ffprobe'。

在任意使用 AudioSegment 之前调用 ensure_pydub_binaries()。
可选环境变量：FFMPEG_PATH / FFPROBE_PATH（或 *_BINARY），指向可执行文件绝对路径。
"""
from __future__ import annotations

import logging
import os
import shutil

logger = logging.getLogger(__name__)

_done = False


def ensure_pydub_binaries() -> None:
    global _done
    if _done:
        return
    _done = True

    sep = os.pathsep
    path = os.environ.get("PATH", "")

    for key in ("FFMPEG_PATH", "FFMPEG_BINARY", "FFPROBE_PATH", "FFPROBE_BINARY"):
        p = (os.environ.get(key) or "").strip()
        if p and os.path.isfile(p):
            d = os.path.dirname(os.path.abspath(p))
            if d:
                parts = path.split(sep) if path else []
                if d not in parts:
                    path = d + sep + path

    # Homebrew（Apple Silicon / Intel）与系统路径（Docker 内 /usr/bin 已有 ffmpeg）
    for d in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"):
        if os.path.isdir(d):
            parts = path.split(sep) if path else []
            if d not in parts:
                path = d + sep + path

    os.environ["PATH"] = path

    try:
        from pydub import AudioSegment

        ff = shutil.which("ffmpeg")
        if ff:
            AudioSegment.converter = ff
    except Exception:
        pass

    if not shutil.which("ffprobe"):
        logger.warning(
            "未在 PATH 中找到 ffprobe（pydub 播客合成需要）。"
            "macOS 请执行: brew install ffmpeg，并保证 /opt/homebrew/bin 在 PATH 中；"
            "或设置 FFPROBE_PATH=/opt/homebrew/bin/ffprobe。"
            "Docker 请使用已 apt install ffmpeg 的镜像并重新构建。"
        )
