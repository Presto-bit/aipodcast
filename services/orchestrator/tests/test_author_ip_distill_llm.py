"""author_ip_distill LLM 路径单测（mock 提供商）。"""
from __future__ import annotations

from unittest.mock import patch

from app.author_ip_distill import run_author_ip_distill
from app.author_ip_distill_llm import (
    build_distill_user_payload,
    distill_profile_with_llm,
    distill_llm_enabled,
)


def test_build_distill_user_payload_includes_one_liner():
    user = build_distill_user_payload(
        [{"title": "文", "body": "先说结论", "materialType": "published", "includeInStyleLearning": True}],
        one_liner="帮职场人写复盘",
    )
    assert "一句话定位" in user
    assert "先说结论" in user


@patch("app.author_ip_distill_llm.invoke_llm_chat_messages_with_minimax_fallback")
def test_distill_profile_with_llm_full(mock_invoke):
    mock_invoke.return_value = (
        '{"tagCloud":["复盘","职场"],"traits":[{"dimension":"立场","label":"结论前置","evidence":"先说结论","defaultOn":true,"confidence":0.9}],"domains":[{"displayName":"复盘总结","boundArticleTitles":["文"],"boundExperienceTemplates":[]}],"recentChange":"更强调结论前置"}',
        None,
    )
    mats = [
        {
            "materialType": "published",
            "title": "文",
            "body": "先说结论：本周重点…",
            "includeInStyleLearning": True,
        }
    ]
    out = distill_profile_with_llm(mats, one_liner="定位", mode="full")
    assert out is not None
    assert "复盘" in out["tagCloud"]
    assert out["traits"][0]["label"] == "结论前置"


@patch("app.author_ip_distill_llm.distill_profile_with_llm")
def test_run_distill_uses_llm_when_available(mock_llm):
    mock_llm.return_value = {
        "tagCloud": ["AI", "测评"],
        "traits": [{"dimension": "语气", "label": "直给", "evidence": "e", "defaultOn": True, "confidence": 0.8}],
        "domains": [{"displayName": "测评", "boundArticleTitles": [], "boundExperienceTemplates": []}],
        "recentChange": "LLM 提炼",
    }
    prof = {"traits": [], "vitality": {}}
    mats = [
        {
            "materialType": "published",
            "title": "t",
            "body": "x" * 50,
            "includeInStyleLearning": True,
        }
    ]
    out = run_author_ip_distill(prof, mats, one_liner="one", mode="full")
    assert out["vitality"]["distillSource"] == "llm"
    assert out["vitality"]["recentChange"] == "LLM 提炼"
    assert any(t.get("label") == "直给" for t in out.get("traits") or [])


@patch("app.author_ip_distill_llm.distill_profile_with_llm", return_value=None)
def test_run_distill_no_llm_fallback(mock_llm):
    assert distill_llm_enabled() in (True, False)
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
