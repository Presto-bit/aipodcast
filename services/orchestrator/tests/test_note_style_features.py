"""note_style_features（P2）单测。"""
from __future__ import annotations

from app.note_style_features import (
    STYLE_FEATURES_VERSION,
    build_heuristic_style_features,
    learning_materials_with_fresh_features,
    parse_style_features,
    style_features_match_hash,
)


def test_parse_style_features_requires_version_and_hash():
    assert parse_style_features(None) is None
    assert parse_style_features({"styleFeatures": {"version": 0}}) is None
    ok = parse_style_features({"styleFeatures": {"version": STYLE_FEATURES_VERSION, "sourceHash": "abc"}})
    assert ok and ok.get("sourceHash") == "abc"


def test_style_features_match_hash():
    f = {"sourceHash": "h1"}
    assert style_features_match_hash(f, "h1")
    assert not style_features_match_hash(f, "h2")
    assert not style_features_match_hash(None, "h1")


def test_build_heuristic_style_features_from_summary():
    out = build_heuristic_style_features(
        title="测评",
        source_hash="deadbeef",
        note_summary="先说结论：适合小白。",
        chunk_texts=["段落二"],
    )
    assert out["version"] == STYLE_FEATURES_VERSION
    assert out["sourceHash"] == "deadbeef"
    assert "结论" in str(out.get("styleSnippet") or "")


def test_learning_materials_with_fresh_features_all_or_none():
    mats = [
        {
            "body": "x",
            "includeInStyleLearning": True,
            "noteRagBodyHash": "h1",
            "styleFeatures": {"version": STYLE_FEATURES_VERSION, "sourceHash": "h1"},
        },
        {
            "body": "y",
            "includeInStyleLearning": True,
            "noteRagBodyHash": "h2",
            "styleFeatures": None,
        },
    ]
    assert learning_materials_with_fresh_features(mats) is None
    mats[1]["styleFeatures"] = {"version": STYLE_FEATURES_VERSION, "sourceHash": "h2"}
    got = learning_materials_with_fresh_features(mats)
    assert got is not None and len(got) == 2
