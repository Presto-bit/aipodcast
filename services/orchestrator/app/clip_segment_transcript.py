"""多段素材：按 object_key 缓存转写结果，增量拼接为整稿时间轴。"""

from __future__ import annotations

import json
import uuid
from typing import Any


def parse_audio_source_segments(row: dict[str, Any]) -> list[dict[str, Any]]:
    st = row.get("audio_source_segments")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except Exception:
            st = []
    if not isinstance(st, list):
        return []
    out: list[dict[str, Any]] = []
    for it in st:
        if isinstance(it, dict) and str(it.get("key") or "").strip():
            out.append(it)
    return out


def parse_segment_transcript_cache(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("audio_segment_transcripts")
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        return {}
    return raw


def normalized_duration_ms(norm: dict[str, Any]) -> int:
    words = norm.get("words") or []
    if not isinstance(words, list):
        return max(0, int(norm.get("duration_ms") or 0))
    dm = int(norm.get("duration_ms") or 0)
    if dm > 0:
        return dm
    end = 0
    for w in words:
        if isinstance(w, dict):
            try:
                end = max(end, int(w.get("e_ms") or 0))
            except (TypeError, ValueError):
                continue
    return end


def list_missing_segment_keys(
    segments: list[dict[str, Any]], cache: dict[str, Any]
) -> list[str]:
    out: list[str] = []
    for seg in segments:
        k = str(seg.get("key") or "").strip()
        if not k:
            continue
        ent = cache.get(k)
        if not isinstance(ent, dict):
            out.append(k)
            continue
        norm = ent.get("normalized")
        if not isinstance(norm, dict):
            out.append(k)
            continue
        w = norm.get("words")
        if not isinstance(w, list) or not w:
            out.append(k)
    return out


def stitch_cached_segment_transcripts(
    segments: list[dict[str, Any]], cache: dict[str, Any]
) -> dict[str, Any] | None:
    """
    若所有分段均有有效缓存，将词级时间轴平移拼接为整轨 duration_ms。
    否则返回 None。
    """
    missing = list_missing_segment_keys(segments, cache)
    if missing:
        return None
    offset = 0
    out_words: list[dict[str, Any]] = []
    ver = 1
    for si, seg in enumerate(segments):
        k = str(seg.get("key") or "").strip()
        ent = cache.get(k) or {}
        norm = ent.get("normalized") if isinstance(ent, dict) else None
        if not isinstance(norm, dict):
            return None
        ver = int(norm.get("version") or ver)
        words = norm.get("words") or []
        if not isinstance(words, list):
            return None
        for w in words:
            if not isinstance(w, dict):
                continue
            try:
                s0 = int(w.get("s_ms") or 0)
                e0 = int(w.get("e_ms") or s0)
            except (TypeError, ValueError):
                s0, e0 = 0, 0
            wid = str(w.get("id") or "").strip()
            nw = dict(w)
            nw["s_ms"] = s0 + offset
            nw["e_ms"] = e0 + offset
            nw["id"] = f"s{si}:{wid}" if wid else f"s{si}:{uuid.uuid4().hex[:10]}"
            out_words.append(nw)
        offset += normalized_duration_ms(norm)
    return {"version": ver, "words": out_words, "duration_ms": offset}
