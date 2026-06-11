from app.composer_expert.intake import resolve_xhs_intake_length, xhs_body_para_max_chars
from app.studio.studio_reply import (
    classify_reply_tier,
    generate_studio_reply,
    is_ops_strategy_question,
)


def test_ops_question_detect():
    assert is_ops_strategy_question("小红书怎么运营")
    assert is_ops_strategy_question("发布之后怎么运营")
    assert not is_ops_strategy_question("把标题改得更犀利")


def test_classify_reply_tier():
    assert classify_reply_tier("小红书怎么运营", has_manuscript=True) == "ops"
    assert classify_reply_tier("这段为什么这样写", has_manuscript=True) == "manuscript_coach"
    assert classify_reply_tier("话题 tag 用什么好", has_manuscript=True) == "manuscript_general"
    assert classify_reply_tier("小红书是什么", has_manuscript=False) == "general"


def test_ops_reply_no_manuscript_uses_platform():
    text = generate_studio_reply("小红书怎么运营", has_manuscript=False)
    assert len(text) > 50
    assert "通用" in text or "框架" in text or "发布时间" in text


def test_resolve_xhs_length_from_task():
    assert resolve_xhs_intake_length({}, "写一篇500字种草") == "medium"
    assert resolve_xhs_intake_length({}, "写1000字长文") == "long"
    assert resolve_xhs_intake_length({"length": "short"}, "写1000字") == "short"
    assert xhs_body_para_max_chars("long") == 120
