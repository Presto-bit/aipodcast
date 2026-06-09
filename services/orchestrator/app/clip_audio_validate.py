"""剪辑上传音频：ffprobe 校验与浏览器可播格式提示。"""

from __future__ import annotations

import tempfile
from pathlib import Path

from .clip_audio_merge import ffprobe_audio_stream_signature, ffprobe_duration_sec

# Chrome / Safari 常见可解码音频编码（波形与试听）
_BROWSER_FRIENDLY_AUDIO_CODECS = frozenset(
    {
        "mp3",
        "aac",
        "opus",
        "vorbis",
        "pcm_s16le",
        "pcm_s24le",
        "pcm_s32le",
        "pcm_f32le",
        "flac",
    }
)

# 上传允许：ffprobe 可读且云端 ASR 可转写；不要求浏览器可预览（如 ALAC）
_UPLOAD_ALLOWED_AUDIO_CODECS = _BROWSER_FRIENDLY_AUDIO_CODECS | frozenset({"alac"})


def is_browser_friendly_codec(codec: str) -> bool:
    """Chrome/Safari 与 WaveSurfer 常见可解码音频编码。"""
    return (codec or "").strip().lower() in _BROWSER_FRIENDLY_AUDIO_CODECS


def _codec_display_name(codec: str) -> str:
    c = (codec or "").strip().lower()
    aliases = {
        "alac": "ALAC（Apple 无损）",
        "ac3": "AC3",
        "eac3": "E-AC3",
        "dts": "DTS",
        "wmalossless": "WMA 无损",
        "wmav2": "WMA",
    }
    return aliases.get(c, c or "未知")


def validate_clip_upload_audio_file(path: Path, *, filename_hint: str = "") -> None:
    """
    校验上传音频可被 ffprobe 读取且 ASR 可处理。
    浏览器不可预览的编码（如 ALAC）仍允许上传；失败时抛出 ValueError。
    """
    hint = (filename_hint or path.name or "audio").strip()
    try:
        sig = ffprobe_audio_stream_signature(path)
        dur = ffprobe_duration_sec(path)
    except RuntimeError as exc:
        raise ValueError(f"无法读取音频（请确认文件未损坏）：{exc}") from exc

    if dur <= 0.05:
        raise ValueError(f"音频时长无效或过短，请换文件重试。（{Path(hint).name}）")

    codec = str(sig.get("codec_name") or "").strip().lower()
    if codec and codec not in _UPLOAD_ALLOWED_AUDIO_CODECS:
        label = _codec_display_name(codec)
        raise ValueError(
            f"当前音频编码为 {label}，暂不支持上传转写。"
            f"请转为 MP3 或 M4A（AAC 编码）后重新上传。（{Path(hint).name}）"
        )


def validate_clip_upload_audio_bytes(data: bytes, *, filename_hint: str) -> None:
    """对内存中的上传字节做 ffprobe 校验。"""
    if not data:
        raise ValueError("音频文件为空")
    fn = (filename_hint or "clip.mp3").strip() or "clip.mp3"
    suf = Path(fn).suffix or ".mp3"
    with tempfile.NamedTemporaryFile(prefix="fyv_clip_val_", suffix=suf, delete=True) as tf:
        tf.write(data)
        tf.flush()
        validate_clip_upload_audio_file(Path(tf.name), filename_hint=fn)
