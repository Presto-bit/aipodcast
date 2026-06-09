"""clip_browser_preview 单元测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from app.clip_audio_validate import is_browser_friendly_codec
from app.clip_browser_preview import browser_preview_cache_key, ensure_browser_playback_object_key


def test_is_browser_friendly_codec() -> None:
    assert is_browser_friendly_codec("aac")
    assert is_browser_friendly_codec("mp3")
    assert not is_browser_friendly_codec("alac")
    assert not is_browser_friendly_codec("aac_latm")
    assert not is_browser_friendly_codec("ac3")


def test_browser_preview_cache_key_stable() -> None:
    k = "clip/user/p1/seg.m4a"
    assert browser_preview_cache_key(k) == browser_preview_cache_key(k)
    assert browser_preview_cache_key(k).startswith("clip/browser_preview/")


def test_ensure_browser_playback_returns_source_for_friendly_codec() -> None:
    src_key = "clip/u/p1/audio.mp3"
    with patch("app.clip_browser_preview.object_key_exists", return_value=False), patch(
        "app.clip_browser_preview.download_object_to_path"
    ) as dl, patch(
        "app.clip_browser_preview.ffprobe_audio_stream_signature",
        return_value={"codec_name": "mp3"},
    ):
        dl.side_effect = lambda _k, dest: dest.write_bytes(b"x")
        assert ensure_browser_playback_object_key(src_key) == src_key


def test_ensure_browser_playback_uses_cached_preview_for_alac() -> None:
    src_key = "clip/u/p1/alac.m4a"
    preview_key = browser_preview_cache_key(src_key)
    with patch("app.clip_browser_preview.object_key_exists", return_value=True):
        assert ensure_browser_playback_object_key(src_key) == preview_key


def test_ensure_browser_playback_transcodes_alac(tmp_path: Path) -> None:
    src_key = "clip/u/p1/alac.m4a"
    preview_key = browser_preview_cache_key(src_key)
    payload = b"fake m4a content padding" * 2

    def fake_transcode(_inp: Path, out: Path) -> None:
        out.write_bytes(payload)

    with patch("app.clip_browser_preview.object_key_exists", return_value=False), patch(
        "app.clip_browser_preview.download_object_to_path"
    ) as dl, patch(
        "app.clip_browser_preview.ffprobe_audio_stream_signature",
        return_value={"codec_name": "alac"},
    ), patch(
        "app.clip_browser_preview._transcode_to_aac_m4a",
        side_effect=fake_transcode,
    ), patch("app.clip_browser_preview.upload_file_path") as up:
        dl.side_effect = lambda _k, dest: dest.write_bytes(b"x")
        assert ensure_browser_playback_object_key(src_key) == preview_key
        up.assert_called_once()
