"""clip_audio_validate 单元测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.clip_audio_validate import validate_clip_upload_audio_file


def test_validate_accepts_alac_m4a(tmp_path: Path) -> None:
    p = tmp_path / "sample.m4a"
    p.write_bytes(b"fake")
    sig = {
        "codec_name": "alac",
        "sample_rate": 44100,
        "channels": 2,
        "channel_layout": "stereo",
        "format_name": "mov,mp4,m4a",
    }
    with (
        patch("app.clip_audio_validate.ffprobe_audio_stream_signature", return_value=sig),
        patch("app.clip_audio_validate.ffprobe_duration_sec", return_value=12.5),
    ):
        validate_clip_upload_audio_file(p, filename_hint="interview.m4a")


def test_validate_rejects_unsupported_codec(tmp_path: Path) -> None:
    p = tmp_path / "sample.m4a"
    p.write_bytes(b"fake")
    sig = {
        "codec_name": "ac3",
        "sample_rate": 44100,
        "channels": 2,
        "channel_layout": "stereo",
        "format_name": "mov,mp4,m4a",
    }
    with (
        patch("app.clip_audio_validate.ffprobe_audio_stream_signature", return_value=sig),
        patch("app.clip_audio_validate.ffprobe_duration_sec", return_value=12.5),
    ):
        with pytest.raises(ValueError, match="暂不支持上传转写"):
            validate_clip_upload_audio_file(p, filename_hint="interview.m4a")


def test_validate_accepts_aac_m4a(tmp_path: Path) -> None:
    p = tmp_path / "sample.m4a"
    p.write_bytes(b"fake")
    sig = {
        "codec_name": "aac",
        "sample_rate": 44100,
        "channels": 2,
        "channel_layout": "stereo",
        "format_name": "mov,mp4,m4a",
    }
    with (
        patch("app.clip_audio_validate.ffprobe_audio_stream_signature", return_value=sig),
        patch("app.clip_audio_validate.ffprobe_duration_sec", return_value=12.5),
    ):
        validate_clip_upload_audio_file(p, filename_hint="interview.m4a")
