"""自媒体发布稿：选项归一化与资料回退草稿。"""
from __future__ import annotations

from unittest.mock import patch

from app.social_llm_utils import extract_partial_social_json_fields
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


def test_fallback_from_material_uses_excerpt_not_generic_xhs() -> None:
    raw = "AI 播客工具测评\n" + "多角色对话和一键导出是核心卖点。" * 20
    pack = _fallback_from_material(raw, "xiaohongshu")
    body = str(pack.get("body") or "")
    assert "AI 播客" in body or "多角色" in body
    assert "📌 先说结论" not in body
    assert "💡 展开" not in body


def test_is_generic_social_placeholder_detects_xhs_template() -> None:
    from app.social_publish_draft import _fallback_xhs

    assert _is_generic_social_placeholder(_fallback_xhs(), "xiaohongshu") is True
    generic = {
        "body": "📌 先说结论\n\n先把作息和防晒稳住。\n\n💡 其次，选温和提亮。",
        "opening_30": "你是不是也一到下午就脸垮？",
    }
    assert _is_generic_social_placeholder(generic, "xiaohongshu") is True


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


def test_generate_succeeds_with_colloquial_first_material() -> None:
    material = "第一优先级\n" + "第一时间完成第一步工作。" * 50
    with patch("app.social_publish_draft.invoke_and_parse_social_json", return_value=(None, None)):
        pack = generate_social_publish_draft(material, platform="wechat_mp", options={})
    body = str(pack.get("body") or "")
    assert "第一时间" in body or "第一步" in body
    assert pack.get("platform") == "wechat_mp"


def test_extract_partial_social_json_fields_from_stream() -> None:
    raw = (
        '{"titles":["标题一","标题二"],'
        '"bodies":["正文一","正文二"],'
        '"theme":"测试主题",'
        '"body":"这是正在生成的正文片段'
    )
    partial = extract_partial_social_json_fields(raw)
    assert partial.get("titles") == ["标题一", "标题二"]
    assert partial.get("bodies") == ["正文一", "正文二"]
    assert partial.get("theme") == "测试主题"
    assert partial.get("body") == "这是正在生成的正文片段"


def test_format_image_suggestion_item_from_dict() -> None:
    from app.social_llm_utils import format_image_suggestion_item, normalize_image_suggestion_lines

    raw = {"position": "头图", "description": "漫画风格：主角与关键词同框"}
    assert format_image_suggestion_item(raw) == "头图：漫画风格：主角与关键词同框"
    assert normalize_image_suggestion_lines([raw, "纯文本建议"]) == [
        "头图：漫画风格：主角与关键词同框",
        "纯文本建议",
    ]
    assert (
        format_image_suggestion_item("{'position': '头图', 'description': '漫画风格'}")
        == "头图：漫画风格"
    )
