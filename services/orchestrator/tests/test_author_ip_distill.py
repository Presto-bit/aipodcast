"""author_ip_distill 蒸馏逻辑单测（v6：无规则引擎）。"""
from __future__ import annotations

from unittest.mock import patch

from app.author_ip_distill import (
    _merge_traits,
    material_in_style_learning,
    run_author_ip_distill,
)


def test_material_learning_flag():
    assert material_in_style_learning({"body": "x", "includeInStyleLearning": True})
    assert not material_in_style_learning({"body": "x", "includeInStyleLearning": False})
    assert not material_in_style_learning({"body": "x", "materialType": "third_party"})


def test_merge_traits_round_robin_across_dimensions() -> None:
    discovered = [
        {"dimension": "立场", "label": f"立场{i}", "defaultOn": True, "confidence": 0.9 - i * 0.01}
        for i in range(4)
    ] + [
        {"dimension": "结构", "label": f"结构{i}", "defaultOn": True, "confidence": 0.85 - i * 0.01}
        for i in range(4)
    ] + [
        {"dimension": "语气", "label": f"语气{i}", "defaultOn": True, "confidence": 0.8 - i * 0.01}
        for i in range(4)
    ]
    merged = _merge_traits([], discovered, max_items=9)
    dims = [t["dimension"] for t in merged]
    assert len(set(dims)) >= 3
    assert dims.count("立场") <= 4


@patch("app.author_ip_distill_llm.distill_profile_with_llm", return_value=None)
def test_run_distill_no_llm_keeps_traits_empty(mock_llm):
    prof = {"traits": [], "vitality": {}}
    mats = [
        {
            "materialType": "published",
            "title": "测评文",
            "body": "先说结论：适合小白",
            "includeInStyleLearning": True,
        }
    ]
    out = run_author_ip_distill(prof, mats, mode="full", fresh_traits=True)
    assert out["vitality"]["distillSource"] == "none"
    assert out.get("traits") == []
    mock_llm.assert_called_once()


@patch("app.author_ip_distill_llm.distill_profile_with_llm")
def test_run_distill_full_sets_vitality(mock_llm):
    mock_llm.return_value = {
        "tagCloud": ["复盘"],
        "traits": [{"dimension": "立场", "label": "结论前置", "evidence": "e", "defaultOn": True, "confidence": 0.9}],
        "domains": [],
        "recentChange": "更强调结论",
    }
    prof = {"traits": [], "vitality": {}}
    mats = [
        {
            "materialType": "experience_card",
            "title": "经历",
            "body": "产品经理",
            "includeInStyleLearning": True,
        }
    ]
    out = run_author_ip_distill(prof, mats, one_liner="帮职场人写复盘", mode="full")
    assert out["vitality"].get("lastLearnedAt")
    assert out["vitality"].get("materialSummary")
    assert out["vitality"]["distillSource"] == "llm"
