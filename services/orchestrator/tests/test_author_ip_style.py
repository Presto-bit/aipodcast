"""author_ip_style 纯函数单测（不依赖 DB/LLM）。"""
from __future__ import annotations

from app.author_ip_style import _pick_domain, _pick_traits, _topic_tokens, build_style_prompt_block


def test_topic_tokens_filters_stopwords():
    tokens = _topic_tokens("如何测评 AI 视频工具会员")
    assert "如何" not in tokens
    assert any("视频" in t or "工具" in t or "会员" in t for t in tokens)


def test_pick_traits_skips_default_off():
    profile = {
        "traits": [
            {"label": "结论前置", "dimension": "结构", "defaultOn": True},
            {"label": "隐藏项", "dimension": "结构", "defaultOn": False},
        ]
    }
    picked = _pick_traits(profile)
    assert len(picked) == 1
    assert picked[0]["label"] == "结论前置"


def test_pick_domain_scores_bound_titles():
    profile = {
        "domains": [
            {
                "displayName": "小红书测评",
                "boundArticleTitles": ["AI 视频工具测评"],
            },
            {"displayName": "公众号长文", "boundArticleTitles": ["行业周报"]},
        ]
    }
    name, conf, _ = _pick_domain(profile, "AI 视频工具会员值不值")
    assert name == "小红书测评"
    assert conf in ("high", "medium")


def test_build_style_prompt_includes_traits():
    block = build_style_prompt_block(
        {"displayName": "阿橘", "oneLiner": "AI 产品测评"},
        traits=[{"dimension": "口吻", "label": "直给", "evidence": "别绕弯"}],
        experiences=[{"title": "踩坑记", "body": "去年买过三家会员"}],
        article_excerpts=[],
        content_type="article",
        scene_name="小红书测评",
    )
    assert "AI 产品测评" in block
    assert "直给" in block
    assert "踩坑记" in block
