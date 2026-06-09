"""clip_export 短语合并与 acrossfade 单元测试。"""

from __future__ import annotations

from app.clip_export import (
    _build_acrossfade_filter_script,
    _merge_phrase_spans,
    _phrase_segments_for_export,
    _pick_room_tone_slice,
)


def test_merge_phrase_spans_merges_close_words() -> None:
    kept = [
        {"s_ms": 0, "e_ms": 200, "text": "你好"},
        {"s_ms": 250, "e_ms": 500, "text": "世界"},
    ]
    spans = _merge_phrase_spans(
        kept,
        merge_gap_ms=400,
        split_gap_ms=700,
        punct_gap_ms=150,
        silence_regions=[],
    )
    assert spans == [(0, 500)]


def test_merge_phrase_spans_splits_on_long_gap() -> None:
    kept = [
        {"s_ms": 0, "e_ms": 200, "text": "第一句"},
        {"s_ms": 1200, "e_ms": 1500, "text": "第二句"},
    ]
    spans = _merge_phrase_spans(
        kept,
        merge_gap_ms=400,
        split_gap_ms=700,
        punct_gap_ms=150,
        silence_regions=[],
    )
    assert spans == [(0, 200), (1200, 1500)]


def test_merge_phrase_spans_splits_on_silence_region() -> None:
    kept = [
        {"s_ms": 0, "e_ms": 200, "text": "a"},
        {"s_ms": 500, "e_ms": 800, "text": "b"},
    ]
    spans = _merge_phrase_spans(
        kept,
        merge_gap_ms=400,
        split_gap_ms=900,
        punct_gap_ms=150,
        silence_regions=[(300, 450)],
    )
    assert spans == [(0, 200), (500, 800)]


def test_phrase_segments_adds_min_bridge() -> None:
    kept = [
        {"s_ms": 0, "e_ms": 200, "text": "a"},
        {"s_ms": 500, "e_ms": 800, "text": "b"},
    ]
    spans = [(0, 200), (500, 800)]
    segs = _phrase_segments_for_export(
        spans,
        long_pause_ms=0,
        long_pause_cap_ms=500,
        min_bridge_ms=80,
    )
    assert segs[0] == (0, 200)
    assert segs[1][0] == 200 and segs[1][1] == 80
    assert segs[2] == (500, 300)


def test_acrossfade_script_single_segment() -> None:
    script = _build_acrossfade_filter_script([(0, 1000)], crossfade_ms=25)
    assert "[out]" in script
    assert "acrossfade" not in script


def test_acrossfade_script_two_segments() -> None:
    script = _build_acrossfade_filter_script([(0, 500), (800, 400)], crossfade_ms=25)
    assert "acrossfade" in script
    assert "c1=tri:c2=tri" in script


def test_pick_room_tone_slice() -> None:
    start, dur = _pick_room_tone_slice([(100, 900), (2000, 2100)], min_ms=400)
    assert start == 100
    assert dur >= 400
