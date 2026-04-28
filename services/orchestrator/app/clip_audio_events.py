"""AED: PANNs first, heuristic fallback."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name) or str(default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or str(default))
    except (TypeError, ValueError):
        return default


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


def _decode_wav_mono_32k_from_file(src: Path) -> tuple[np.ndarray, int]:
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.NamedTemporaryFile(prefix="fyv_aed_32k_", suffix=".wav", delete=True) as tf:
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
            "32000",
            "-f",
            "wav",
            str(out_wav),
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        raw = out_wav.read_bytes()
    if len(raw) <= 44:
        return np.zeros(0, dtype=np.float32), 32000
    pcm = np.frombuffer(raw[44:], dtype=np.int16).astype(np.float32) / 32768.0
    return pcm, 32000


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
    # 额外特征：过零率 / 谱流（帧间变化），帮助区分稳定背景音乐与突发事件
    zcr = float(np.mean(np.abs(np.diff(np.sign(x)))) * 0.5)
    mid = x.size // 2
    x1 = x[:mid] if mid > 0 else x
    x2 = x[mid:] if mid > 0 else x
    p1 = np.abs(np.fft.rfft(x1 * np.hanning(max(8, x1.size)))) + 1e-9
    p2 = np.abs(np.fft.rfft(x2 * np.hanning(max(8, x2.size)))) + 1e-9
    n = min(p1.size, p2.size)
    if n > 0:
        a1 = p1[:n] / (np.sum(p1[:n]) + 1e-9)
        a2 = p2[:n] / (np.sum(p2[:n]) + 1e-9)
        flux = float(np.sum(np.maximum(0.0, a2 - a1)))
    else:
        flux = 0.0
    # 简易突发峰值：笑声/掌声常有较强瞬时峰
    peak = float(np.max(np.abs(x)))
    crest = peak / (rms + 1e-9)

    if (crest > 8.5 and centroid > 1700 and flux > 0.08) or (zcr > 0.18 and flux > 0.12 and rms > 0.035):
        if rms > 0.07:
            return "applause", 0.58
        return "laughter", 0.52
    if centroid < 1550 and flatness < 0.32 and rms > 0.022 and flux < 0.16:
        conf = 0.52 + max(0.0, (0.32 - flatness)) * 0.8
        return "music", min(0.88, conf)
    noise_conf = 0.3 + min(0.45, flatness * 0.9) + min(0.2, zcr * 0.4)
    return "noise", min(0.9, max(0.2, noise_conf))


def _merge_labeled_segments(
    segs: list[tuple[int, int, str, float]], min_ms: int = 450
) -> list[dict[str, Any]]:
    if not segs:
        return []
    out: list[tuple[int, int, str, float, int]] = []
    for s, e, lab, conf in segs:
        merge_gap = 260 if lab in ("music", "noise") else 180
        if out and out[-1][2] == lab and s - out[-1][1] <= merge_gap:
            ps, pe, pl, pc, n = out[-1]
            out[-1] = (ps, e, pl, (pc * n + conf) / (n + 1), n + 1)
        else:
            out.append((s, e, lab, conf, 1))
    res: list[dict[str, Any]] = []
    for s, e, lab, conf, _n in out:
        long_min_ms = max(300, _env_int("CLIP_AED_MIN_KEEP_MUSIC_NOISE_MS", 700))
        min_keep_ms = long_min_ms if lab in ("music", "noise") else min_ms
        if e - s < min_keep_ms:
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


def _panns_label_aliases() -> dict[str, set[str]]:
    return {
        "music": {"music", "background music"},
        "noise": {"noise", "static", "hiss", "hum", "crowd", "traffic", "engine", "wind", "rain"},
        "laughter": {"laughter", "giggle", "chuckle"},
        "applause": {"applause", "clapping", "cheering"},
    }


def _map_panns_classes_to_labels(class_names: list[str]) -> dict[str, list[int]]:
    aliases = _panns_label_aliases()
    out: dict[str, list[int]] = {k: [] for k in aliases}
    for i, name in enumerate(class_names):
        n = str(name or "").strip().lower()
        if not n:
            continue
        for lb, keys in aliases.items():
            if any(k in n for k in keys):
                out[lb].append(i)
    return out


def _detect_audio_events_panns(file_path: Path) -> list[dict[str, Any]]:
    # Lazy import to keep service boot light and allow fallback.
    try:
        from panns_inference import AudioTagging  # type: ignore
        from panns_inference.labels import labels as panns_labels  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"panns_unavailable:{e}") from e

    pcm, sr = _decode_wav_mono_32k_from_file(file_path)
    if pcm.size == 0:
        return []
    if sr != 32000:
        return []

    tagger = AudioTagging(checkpoint_path=None, device="cuda" if os.getenv("CLIP_AED_PANNS_CUDA", "0") == "1" else "cpu")
    # panns_inference expects int16-like waveform in float32 range [-1,1], mono
    clipwise_output, _embedding = tagger.inference(pcm[None, :])
    if clipwise_output is None or len(clipwise_output) == 0:
        return []
    scores = np.asarray(clipwise_output[0], dtype=np.float32)
    class_names = list(panns_labels) if isinstance(panns_labels, (list, tuple)) else []
    if not class_names or scores.size != len(class_names):
        return []

    idx_map = _map_panns_classes_to_labels(class_names)
    conf_th = max(0.05, min(0.95, _env_float("CLIP_AED_PANNS_CONF_TH", 0.18)))

    # PANNs is clip-level; emit full-span events for high-confidence classes.
    duration_ms = int(round((pcm.size / 32000.0) * 1000.0))
    out: list[dict[str, Any]] = []
    for lb in ("music", "noise", "laughter", "applause"):
        ids = idx_map.get(lb) or []
        if not ids:
            continue
        conf = float(np.max(scores[ids]))
        if conf < conf_th:
            continue
        out.append(
            {
                "id": f"{lb}-0-{duration_ms}",
                "start_ms": 0,
                "end_ms": duration_ms,
                "label": lb,
                "confidence": round(conf, 4),
                "action": "keep",
            }
        )
    return out


def detect_audio_events_from_file(file_path: Path) -> list[dict[str, Any]]:
    backend = str(os.getenv("CLIP_AED_BACKEND") or "panns").strip().lower()
    if backend in {"panns", "auto"}:
        try:
            panns_events = _detect_audio_events_panns(file_path)
            if panns_events:
                return panns_events
            if backend == "panns":
                return []
        except Exception:
            if backend == "panns":
                return []

    # Heuristic fallback.
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
    merged = _merge_labeled_segments(raw, min_ms=max(200, _env_int("CLIP_AED_MIN_KEEP_MS", 450)))
    # 仅保留可编辑价值较高的事件，避免 UI 噪点过多。
    conf_th = max(0.05, min(0.95, _env_float("CLIP_AED_CONF_TH", 0.42)))
    return [x for x in merged if float(x.get("confidence") or 0) >= conf_th]

