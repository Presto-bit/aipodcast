"""自媒体发布稿：选项归一化与资料回退草稿。"""
from __future__ import annotations

from app.social_publish_draft import (
    _fallback_from_material,
    _normalize_social_options,
)


def test_normalize_gender_female_and_male_becomes_any() -> None:
    opts = _normalize_social_options(
        {"persona": {"genders": ["female", "male"], "ageRanges": ["25_34"]}},
        "xiaohongshu",
    )
    assert opts["persona"]["genders"] == ["any"]


def test_fallback_from_material_uses_excerpt_not_generic_mp() -> None:
    raw = "量子计算入门\n" + "超导比特与纠错码是核心。" * 20
    pack = _fallback_from_material(raw, "wechat_mp")
    body = str(pack.get("body") or "")
    assert "量子计算" in body or "超导" in body
    assert "要点一" not in body
    assert "先把最重要的信息说清楚" not in body
