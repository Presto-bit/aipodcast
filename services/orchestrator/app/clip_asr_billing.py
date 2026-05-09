"""剪辑 ASR：按输入音频时长估算 / 结算钱包扣费（与豆包 Seed 按音频时长计费对齐口径）。"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

from .clip_audio_merge import ffprobe_duration_sec
from .clip_segment_transcript import list_missing_segment_keys, parse_audio_source_segments, parse_segment_transcript_cache
from .object_store import get_object_bytes

logger = logging.getLogger(__name__)


def _duration_sec_from_bytes(data: bytes, *, suffix: str) -> float:
    suf = (suffix or ".mp3").strip()
    if not suf.startswith("."):
        suf = f".{suf}"
    with tempfile.NamedTemporaryFile(prefix="fyv_asr_bill_", suffix=suf, delete=True) as tf:
        tf.write(data)
        tf.flush()
        return float(ffprobe_duration_sec(Path(tf.name)))


def audio_bytes_billable_seconds(data: bytes, *, filename_hint: str) -> float:
    """对整块音频字节取时长（秒），用于单文件主轨。"""
    fn = (filename_hint or "clip.mp3").strip() or "clip.mp3"
    suf = Path(fn).suffix or ".mp3"
    return max(0.0, _duration_sec_from_bytes(data, suffix=suf))


def object_key_billable_seconds(object_key: str, *, filename_hint: str) -> float:
    raw = get_object_bytes(object_key)
    return audio_bytes_billable_seconds(raw, filename_hint=filename_hint)


def clip_transcribe_keys_to_bill(
    row: dict[str, Any],
    *,
    force_retranscribe: bool,
    only_segment_keys: list[str] | None,
) -> tuple[list[str], bool]:
    """
    返回 (segment_keys_to_bill, is_single_main_track)。
    - 多段：键列表为本次将送入 ASR 的分段 object_key。
    - 单轨：segment 列表为空且返回 is_single_main_track=True（调用方用主 audio_object_key 计时长）。
    """
    segments = parse_audio_source_segments(row)
    if not segments:
        key = str(row.get("audio_object_key") or "").strip()
        return ([], bool(key))

    cache = parse_segment_transcript_cache(row)
    missing = list_missing_segment_keys(segments, cache)
    seg_keys = {str(s.get("key") or "").strip() for s in segments if str(s.get("key") or "").strip()}

    if force_retranscribe and only_segment_keys:
        out = [str(k).strip() for k in only_segment_keys if str(k).strip() and str(k).strip() in seg_keys]
        return (out, False)

    if force_retranscribe and segments:
        # 与 worker 在未传 segment keys 时 clear 全部分段缓存再全量识别一致
        return ([str(s.get("key") or "").strip() for s in segments if str(s.get("key") or "").strip()], False)

    return (missing, False)


def estimate_clip_transcribe_billable_seconds(
    row: dict[str, Any],
    *,
    force_retranscribe: bool,
    only_segment_keys: list[str] | None,
) -> float:
    """与 worker 实际送入 ASR 的分段集合一致，按 ffprobe 计量总秒数。"""
    keys, single_main = clip_transcribe_keys_to_bill(
        row, force_retranscribe=force_retranscribe, only_segment_keys=only_segment_keys
    )
    if single_main:
        audio_key = str(row.get("audio_object_key") or "").strip()
        if not audio_key:
            return 0.0
        fn = str(row.get("audio_filename") or "clip.mp3").strip() or "clip.mp3"
        try:
            return object_key_billable_seconds(audio_key, filename_hint=fn)
        except Exception as exc:
            logger.warning("estimate_asr_duration main failed key=%s err=%s", audio_key[:48], exc)
            raise

    total = 0.0
    key_to_seg = {
        str(s.get("key") or "").strip(): s
        for s in parse_audio_source_segments(row)
        if str(s.get("key") or "").strip()
    }
    for sk in keys:
        seg = key_to_seg.get(sk) or {}
        fn = str(seg.get("filename") or "segment.mp3").strip() or "segment.mp3"
        try:
            total += object_key_billable_seconds(sk, filename_hint=fn)
        except Exception as exc:
            logger.warning("estimate_asr_duration segment failed key=%s err=%s", sk[:48], exc)
            raise
    return max(0.0, total)
