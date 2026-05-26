"""author_ip_materials 成熟度计算单测。"""
from __future__ import annotations

from app.author_ip_materials import _compute_maturity


def test_maturity_empty():
    assert _compute_maturity({}, []) == "empty"


def test_maturity_sketch_after_cold_start():
    prof = {"coldStart": {"completedAt": True}, "traits": [{"label": "a"}]}
    assert _compute_maturity(prof, []) == "sketch"


def test_maturity_ready_with_articles_and_traits():
    prof = {"traits": [{}, {}, {}]}
    mats = [
        {"materialType": "experience_card"},
        {"materialType": "published"},
    ]
    assert _compute_maturity(prof, mats) == "ready"
