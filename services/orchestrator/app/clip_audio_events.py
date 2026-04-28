"""轻量 AED（占位版）：基于能量与频谱特征提取非语音事件片段。"""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np


def _decode_wav_mono_16k_from_file(src: Path) -> tuple[np.ndarray, int]:
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.NamedTemporaryFile(prefix="fyv_aed_", suffix=".wav", delete=True) as tf:
        out_wav = Path(tf.name)
        cmd = [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            str(out_wav),
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        raw = out_wav.read_bytes()
    if len(raw) <= 44:
        return np.zeros(0, dtype=np.float32), 16000
    pcm = np.frombuffer(raw[44:], dtype=np.int16).astype(np.float32) / 32768.0
    return pcm, 16000


def _label_window(x: np.ndarray, sr: int) -> tuple[str, float]:
    if x.size < max(128, sr // 20):
        return "noise", 0.35
    rms = float(np.sqrt(np.mean(np.square(x)) + 1e-12))
    if rms < 0.015:
        return "noise", 0.2
    # 频谱重心与平坦度：音乐通常更低重心、较低平坦度；噪声平坦度更高
    spec = np.abs(np.fft.rfft(x * np.hanning(x.size)))
    freqs = np.fft.rfftfreq(x.size, d=1.0 / sr)
    power = spec + 1e-9
    centroid = float(np.sum(freqs * power) / np.sum(power))
    flatness = float(np.exp(np.mean(np.log(power))) / np.mean(power))
    # 简易突发峰值：笑声/掌声常有较强瞬时峰
    peak = float(np.max(np.abs(x)))
    crest = peak / (rms + 1e-9)

    if crest > 9.0 and centroid > 1800:
        if rms > 0.07:
            return "applause", 0.58
        return "laughter", 0.52
    if centroid < 1400 and flatness < 0.28 and rms > 0.025:
        return "music", 0.6
    return "noise", min(0.8, 0.35 + rms * 2.0)


def _merge_labeled_segments(
    segs: list[tuple[int, int, str, float]], min_ms: int = 450
) -> list[dict[str, Any]]:
    if not segs:
        return []
    out: list[tuple[int, int, str, float, int]] = []
    for s, e, lab, conf in segs:
        if out and out[-1][2] == lab and s - out[-1][1] <= 220:
            ps, pe, pl, pc, n = out[-1]
            out[-1] = (ps, e, pl, (pc * n + conf) / (n + 1), n + 1)
        else:
            out.append((s, e, lab, conf, 1))
    res: list[dict[str, Any]] = []
    for s, e, lab, conf, _n in out:
        if e - s < min_ms:
            continue
        res.append(
            {
                "id": f"{lab}-{s}-{e}",
                "start_ms": s,
                "end_ms": e,
                "label": lab,
                "confidence": round(float(conf), 4),
                "action": "keep",
            }
        )
    return res


def detect_audio_events_from_file(file_path: Path) -> list[dict[str, Any]]:
    pcm, sr = _decode_wav_mono_16k_from_file(file_path)
    if pcm.size == 0:
        return []
    win = int(sr * 0.64)
    hop = int(sr * 0.32)
    if win <= 0 or hop <= 0:
        return []
    raw: list[tuple[int, int, str, float]] = []
    i = 0
    n = pcm.size
    while i + win <= n:
        w = pcm[i : i + win]
        lab, conf = _label_window(w, sr)
        if lab in ("music", "noise", "laughter", "applause"):
            s_ms = int(round(i * 1000.0 / sr))
            e_ms = int(round((i + win) * 1000.0 / sr))
            raw.append((s_ms, e_ms, lab, conf))
        i += hop
    return _merge_labeled_segments(raw)

