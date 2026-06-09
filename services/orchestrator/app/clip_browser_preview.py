"""剪辑音频浏览器试听：对 ALAC 等不可解码编码按需转 AAC 并缓存。"""

from __future__ import annotations

import hashlib
import logging
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from .clip_audio_merge import ffprobe_audio_stream_signature
from .clip_audio_validate import is_browser_friendly_codec
from .object_store import download_object_to_path, object_key_exists, upload_file_path

logger = logging.getLogger(__name__)

_playback_key_cache: dict[str, str] = {}


def browser_preview_cache_key(source_object_key: str) -> str:
    digest = hashlib.sha256(source_object_key.encode("utf-8")).hexdigest()[:40]
    return f"clip/browser_preview/{digest}.m4a"


def _transcode_to_aac_m4a(inp: Path, out: Path) -> None:
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(inp),
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(out),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=7200)
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or b"").decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"browser preview transcode failed: {err}") from exc


def ensure_browser_playback_object_key(source_object_key: str) -> str:
    """
    返回可供浏览器/WaveSurfer 解码的对象键。
    浏览器友好编码直传原 key；否则转 AAC 写入缓存 key。
    """
    key = (source_object_key or "").strip()
    if not key:
        raise ValueError("empty object key")

    cached = _playback_key_cache.get(key)
    if cached:
        return cached

    preview_key = browser_preview_cache_key(key)
    if object_key_exists(preview_key):
        _playback_key_cache[key] = preview_key
        return preview_key

    with tempfile.TemporaryDirectory(prefix="fyv_clip_browser_") as td:
        td_path = Path(td)
        src_path = td_path / "source.bin"
        download_object_to_path(key, src_path)
        sig = ffprobe_audio_stream_signature(src_path)
        codec = str(sig.get("codec_name") or "").strip().lower()
        if is_browser_friendly_codec(codec):
            _playback_key_cache[key] = key
            return key

        out_path = td_path / "preview.m4a"
        _transcode_to_aac_m4a(src_path, out_path)
        if not out_path.is_file() or out_path.stat().st_size < 32:
            raise RuntimeError("browser preview transcode produced empty output")
        upload_file_path(preview_key, out_path, "audio/mp4")

    _playback_key_cache[key] = preview_key
    logger.info("clip browser preview cached source_tail=%s preview_tail=%s", key[-48:], preview_key[-48:])
    return preview_key


def schedule_prewarm_browser_playback_object_key(source_object_key: str) -> None:
    """上传/合并后后台预热浏览器试听缓存，避免首次波形请求长时间阻塞。"""
    key = (source_object_key or "").strip()
    if not key:
        return

    def _run() -> None:
        try:
            ensure_browser_playback_object_key(key)
        except Exception:
            logger.exception("clip browser preview prewarm failed key_tail=%s", key[-48:])

    threading.Thread(target=_run, daemon=True, name="clip-browser-preview-prewarm").start()
