"""自媒体发布稿：选项归一化与资料回退草稿。"""
from __future__ import annotations

from unittest.mock import patch

from app.social_publish_draft import (
    _fallback_from_material,
    _is_generic_social_placeholder,
    _normalize_social_options,
    generate_social_publish_draft,
)


def test_normalize_gender_female_and_male_becomes_any() -> None:
    opts = _normalize_social_options(
        {"persona": {"genders": ["female", "male"], "ageRanges": ["25_34"]}},
        "xiaohongshu",
    )
    assert opts["persona"]["genders"] == ["any"]


def test_generate_succeeds_when_llm_returns_none() -> None:
    material = "主题资料\n" + "具体要点内容。" * 40
    with patch("app.social_publish_draft.invoke_and_parse_social_json", return_value=(None, None)):
        pack = generate_social_publish_draft(material, platform="wechat_mp", options={})
    body = str(pack.get("body") or "")
    assert pack.get("success") is not True  # pack is flat, success added by route
    assert "主题资料" in body or "具体要点" in body
    assert "先把最重要的信息说清楚" not in body


def test_fallback_from_material_uses_excerpt_not_generic_mp() -> None:
    raw = "量子计算入门\n" + "超导比特与纠错码是核心。" * 20
    pack = _fallback_from_material(raw, "wechat_mp")
    body = str(pack.get("body") or "")
    assert "量子计算" in body or "超导" in body
    assert "要点一" not in body
    assert "先把最重要的信息说清楚" not in body


def test_is_generic_social_placeholder_detects_mp_template() -> None:
    from app.social_publish_draft import _fallback_mp

    assert _is_generic_social_placeholder(_fallback_mp(), "wechat_mp") is True
    material_pack = _fallback_from_material("量子计算入门\n" + "超导比特与纠错码是核心。" * 20, "wechat_mp")
    assert _is_generic_social_placeholder(material_pack, "wechat_mp") is False


def test_generate_rejects_generic_llm_json() -> None:
    material = "新能源汽车补贴\n" + "地方置换补贴与充电设施是读者最关心的。" * 30
    generic_llm = {
        "titles": ["标题一", "标题二", "标题三"],
        "cover_hook": "标题一",
        "opening_30": "如果你最近也在关注这个话题，这篇值得读完。",
        "body": "## 核心结论\n\n先把最重要的信息说清楚。\n\n## 展开说明\n\n- 要点一\n- 要点二\n\n## 小结\n\n欢迎转发给需要的朋友。",
        "tags": ["深度好文"],
        "interaction": "你觉得哪一点最有用？欢迎留言讨论。",
        "imageSuggestions": ["头图建议"],
        "theme": "导读",
    }
    with patch(
        "app.social_publish_draft.invoke_and_parse_social_json",
        return_value=(generic_llm, "trace-1"),
    ):
        pack = generate_social_publish_draft(material, platform="wechat_mp", options={})
    body = str(pack.get("body") or "")
    assert "先把最重要的信息说清楚" not in body
    assert "要点一" not in body
    assert "新能源汽车" in body or "充电设施" in body or "置换补贴" in body
