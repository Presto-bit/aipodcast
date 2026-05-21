from app.legacy_bridge import (
    _join_script_continued,
    _paragraph_looks_like_article_farewell,
    _trim_article_farewell_trailing,
)


def test_paragraph_looks_like_article_farewell_detects_next_chat():
    assert _paragraph_looks_like_article_farewell("希望今晚的分享，能让你清醒。咱们下次再聊。") is True


def test_trim_article_farewell_trailing_removes_closing_paragraph():
    acc = (
        "储蓄很重要，资本要投向生产。\n\n"
        "夜深了，故事讲完了。你可能会觉得，这不就是个儿童寓言嘛。\n"
        "但道理，从来不怕旧。希望今晚的分享，能让你对身边那些“专家”言论多一分清醒。\n"
        "咱们下次再聊。"
    )
    out = _trim_article_farewell_trailing(acc)
    assert "咱们下次再聊" not in out
    assert "储蓄很重要" in out


def test_join_script_continued_strips_farewell_before_article_piece():
    acc = "上文论述一段。\n\n咱们下次再聊。"
    piece = "明白了，艾伯这张渔网并不只是一张渔网。"
    joined = _join_script_continued(acc, piece, "article")
    assert "咱们下次再聊" not in joined
    assert joined.endswith("渔网并不只是一张渔网。")
