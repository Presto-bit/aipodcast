"""转写二阶段精修：低分窗口局部重识别 + 句边界重排（不改原始音频）。"""

from __future__ import annotations

import logging
import os
from io import BytesIO
from typing import Any

from pydub import AudioSegment

from .clip_transcript_normalize import normalize_volc_flash_transcript
from .volcengine_seed_asr_client import volc_seed_recognize_url_wait

logger = logging.getLogger(__name__)


def _infer_audio_format(filename: str | None, mime: str | None) -> str:
    fn = str(filename or "").lower().strip()
    for suf in (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm"):
        if fn.endswith(suf):
            return suf.removeprefix(".")
    mm = str(mime or "").lower().strip()
    if "wav" in mm:
        return "wav"
    if "mpeg" in mm or "mp3" in mm:
        return "mp3"
    if "mp4" in mm or "m4a" in mm:
        return "mp4"
    if "flac" in mm:
        return "flac"
    if "ogg" in mm or "opus" in mm:
        return "ogg"
    return "mp3"


def _sentence_ranges(words: list[dict[str, Any]]) -> list[tuple[int, int]]:
    if not words:
        return []
    out: list[tuple[int, int]] = []
    start = 0
    for i in range(1, len(words)):
        if bool(words[i].get("utt_new")):
            out.append((start, i - 1))
            start = i
    out.append((start, len(words) - 1))
    return out


def _sentence_quality(words: list[dict[str, Any]], s: int, e: int) -> float:
    chunk = words[s : e + 1]
    if not chunk:
        return 1.0
    chars = sum(len(str(w.get("text") or "") + str(w.get("punct") or "")) for w in chunk)
    dur_ms = max(1, int(chunk[-1].get("e_ms", 0)) - int(chunk[0].get("s_ms", 0)))
    tail = str(chunk[-1].get("punct") or "").strip()
    conf = 0.0
    n = 0
    for w in chunk:
        for k in ("confidence", "conf", "probability"):
            v = w.get(k)
            try:
                if v is None:
                    continue
                f = float(v)
                if f > 1:
                    f = f / 100.0
                conf += max(0.0, min(1.0, f))
                n += 1
                break
            except (TypeError, ValueError):
                continue
    avg_conf = conf / n if n > 0 else 0.6
    score = 0.5 * avg_conf + 0.3
    if chars > 56:
        score -= 0.2
    if dur_ms > 9000:
        score -= 0.2
    if not tail or tail[-1] not in "。！？!?…":
        score -= 0.12
    return max(0.0, min(1.0, score))


def _pick_low_windows(words: list[dict[str, Any]]) -> list[tuple[int, int]]:
    rs = _sentence_ranges(words)
    if not rs:
        return []
    try:
        threshold = float(os.getenv("CLIP_ASR_LOW_SENTENCE_QUALITY") or "0.58")
    except (TypeError, ValueError):
        threshold = 0.58
    try:
        max_windows = int(os.getenv("CLIP_ASR_REFINE_MAX_WINDOWS") or "4")
    except (TypeError, ValueError):
        max_windows = 4
    max_windows = max(0, min(12, max_windows))
    cand: list[tuple[float, tuple[int, int]]] = []
    for s, e in rs:
        q = _sentence_quality(words, s, e)
        if q < threshold:
            cand.append((q, (s, e)))
    cand.sort(key=lambda x: x[0])
    out = [w for _, w in cand[:max_windows]]
    out.sort(key=lambda x: x[0])
    return out


def _slice_audio_mp3(audio: AudioSegment, start_ms: int, end_ms: int) -> bytes:
    buf = BytesIO()
    seg = audio[max(0, start_ms) : max(start_ms + 1, end_ms)]
    seg.export(buf, format="mp3")
    return buf.getvalue()


def _snap_boundary_to_word(words: list[dict[str, Any]], target_ms: int, lo: int, hi: int, max_snap_ms: int) -> int | None:
    best_i: int | None = None
    best_d = max_snap_ms + 1
    for i in range(max(0, lo), min(len(words), hi + 1)):
        d = abs(int(words[i].get("s_ms", 0)) - int(target_ms))
        if d < best_d:
            best_d = d
            best_i = i
    if best_i is None or best_d > max_snap_ms:
        return None
    return best_i


def _apply_refined_boundaries(
    *,
    words: list[dict[str, Any]],
    win_start_idx: int,
    win_end_idx: int,
    refined_boundary_times_ms: list[int],
) -> int:
    for i in range(win_start_idx + 1, win_end_idx + 1):
        words[i]["utt_new"] = False
    try:
        max_snap_ms = int(os.getenv("CLIP_ASR_REFINE_SNAP_MAX_MS") or "280")
    except (TypeError, ValueError):
        max_snap_ms = 280
    max_snap_ms = max(60, min(1000, max_snap_ms))
    applied = 0
    for ts in refined_boundary_times_ms:
        idx = _snap_boundary_to_word(words, ts, win_start_idx + 1, win_end_idx, max_snap_ms=max_snap_ms)
        if idx is None:
            continue
        words[idx]["utt_new"] = True
        applied += 1
    return applied


def refine_transcript_two_stage(
    *,
    raw_transcript: dict[str, Any],
    audio_bytes: bytes,
    audio_filename: str | None,
    audio_mime: str | None,
    diarization_enabled: bool,
    speaker_hint: int | None,
    channel_ids: list[int] | None,
    corpus_hotwords: list[str] | None,
    corpus_scene: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    阶段1：全量 ASR 归一化。
    阶段2：仅对低分句窗口做局部重识别，回写句边界（utt_new）。
    """
    normalized = normalize_volc_flash_transcript(
        raw_transcript,
        profile="auto",
        speaker_hint=speaker_hint,
    )
    words = normalized.get("words")
    if not isinstance(words, list) or not words:
        return normalized, {"second_stage": "skipped_empty"}
    if str(os.getenv("CLIP_ASR_TWO_STAGE_ENABLED") or "1").strip().lower() in ("0", "false", "off", "no"):
        return normalized, {"second_stage": "disabled"}

    windows = _pick_low_windows(words)
    if not windows:
        return normalized, {"second_stage": "no_low_windows", "windows": 0}

    fmt = _infer_audio_format(audio_filename, audio_mime)
    audio = AudioSegment.from_file(BytesIO(audio_bytes), format=fmt)
    try:
        pad_ms = int(os.getenv("CLIP_ASR_REFINE_WINDOW_PAD_MS") or "320")
    except (TypeError, ValueError):
        pad_ms = 320
    pad_ms = max(0, min(2000, pad_ms))

    refined_windows = 0
    applied_boundaries = 0
    for s_idx, e_idx in windows:
        s_ms = int(words[s_idx].get("s_ms", 0))
        e_ms = int(words[e_idx].get("e_ms", s_ms))
        cut_s = max(0, s_ms - pad_ms)
        cut_e = min(len(audio), e_ms + pad_ms)
        if cut_e - cut_s < 250:
            continue
        try:
            clip_bytes = _slice_audio_mp3(audio, cut_s, cut_e)
            raw_clip = volc_seed_recognize_url_wait(
                file_url="",
                audio_bytes=clip_bytes,
                diarization_enabled=diarization_enabled,
                channel_ids=channel_ids,
                audio_filename="refine-window.mp3",
                audio_mime="audio/mpeg",
                corpus_hotwords=corpus_hotwords,
                corpus_scene=corpus_scene,
            )
            clip_norm = normalize_volc_flash_transcript(
                raw_clip,
                profile="interview" if diarization_enabled else "monologue",
                speaker_hint=speaker_hint,
            )
            clip_words = clip_norm.get("words")
            if not isinstance(clip_words, list) or len(clip_words) <= 1:
                continue
            boundary_ts: list[int] = []
            for i in range(1, len(clip_words)):
                if bool(clip_words[i].get("utt_new")):
                    boundary_ts.append(cut_s + int(clip_words[i].get("s_ms", 0)))
            if not boundary_ts:
                continue
            applied_boundaries += _apply_refined_boundaries(
                words=words,
                win_start_idx=s_idx,
                win_end_idx=e_idx,
                refined_boundary_times_ms=boundary_ts,
            )
            refined_windows += 1
        except Exception as exc:
            logger.warning("clip refine window failed s=%s e=%s err=%s", s_idx, e_idx, exc)
            continue

    return normalized, {
        "second_stage": "done" if refined_windows > 0 else "no_effect",
        "windows": len(windows),
        "refined_windows": refined_windows,
        "applied_boundaries": applied_boundaries,
    }

