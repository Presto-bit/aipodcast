"""播客 TTS 后可选轻量 BGM 混音（P2+）。BGM 文件沿用 legacy_backend/assets。"""
from __future__ import annotations

import io
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def _resolve_bgm_path(slot: str) -> str | None:
    slot = (slot or "bgm01").strip().lower()
    env_key = "BGM_BGM01_PATH" if slot == "bgm01" else "BGM_BGM02_PATH"
    env_path = os.environ.get(env_key)
    if env_path and os.path.isfile(env_path):
        return env_path
    app_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(app_dir, "../../.."))
    name = "bgm01.wav" if slot == "bgm01" else "bgm02.wav"
    p = os.path.join(repo_root, "legacy_backend", "assets", name)
    return p if os.path.isfile(p) else None


def _loop_bgm_to_length(bgm: Any, length_ms: int) -> Any:
    from pydub import AudioSegment  # type: ignore

    if length_ms <= 0:
        return AudioSegment.silent(duration=0)
    out = AudioSegment.silent(duration=0)
    while len(out) < length_ms:
        out += bgm
    return out[:length_ms]


def mp3_hex_duration_sec(hex_str: str) -> float | None:
    """从 MP3 hex 估算时长（秒），失败返回 None。"""
    h = str(hex_str or "").strip()
    if not h or len(h) % 2 != 0:
        return None
    try:
        from pydub import AudioSegment  # type: ignore

        seg = AudioSegment.from_mp3(io.BytesIO(bytes.fromhex(h)))
        return float(len(seg)) / 1000.0
    except Exception:
        return None


def maybe_mix_podcast_bgm(voice_hex: str, payload: dict[str, Any]) -> str:
    """若 payload.mix_bgm 为真且存在 BGM 文件，将人声与背景乐混音后返回 hex；失败则回退原 hex。"""
    if not voice_hex or not bool(payload.get("mix_bgm")):
        return voice_hex
    slot = str(payload.get("bgm_slot") or "bgm01").strip().lower()
    path = _resolve_bgm_path(slot)
    if not path:
        logger.warning("mix_bgm: BGM 文件不存在，跳过混音 (slot=%s)", slot)
        return voice_hex
    try:
        gain = float(payload.get("bgm_gain_db") or -18.0)
    except (TypeError, ValueError):
        gain = -18.0
    gain = max(-36.0, min(0.0, gain))

    try:
        from pydub import AudioSegment  # type: ignore

        voice = AudioSegment.from_mp3(io.BytesIO(bytes.fromhex(voice_hex)))
        bgm = AudioSegment.from_wav(path).apply_gain(gain)
        bgm_looped = _loop_bgm_to_length(bgm, len(voice))
        mixed = voice.overlay(bgm_looped)
        buf = io.BytesIO()
        mixed.export(buf, format="mp3")
        return buf.getvalue().hex()
    except Exception as exc:
        logger.warning("mix_bgm failed: %s", exc)
        return voice_hex
