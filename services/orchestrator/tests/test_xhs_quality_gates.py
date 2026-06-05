from app.composer_expert.generate import (
    _xhs_corpus_anchor_errors,
    _xhs_opening_hook_errors,
)


def test_opening_hook_rejects_weak_open() -> None:
    errs = _xhs_opening_hook_errors({"body": "很多人都知道护肤很重要，今天来聊聊。"})
    assert errs


def test_opening_hook_accepts_question() -> None:
    errs = _xhs_opening_hook_errors({"body": "你是不是也一到下午就脸垮？我试了 3 个办法。"})
    assert not errs


def test_corpus_anchor_required_when_rag() -> None:
    errs = _xhs_corpus_anchor_errors({"body": "这是一段没有资料引用的正文。"}, used_rag=True)
    assert errs


def test_corpus_anchor_ok_with_marker() -> None:
    errs = _xhs_corpus_anchor_errors(
        {"body": "资料中提到转化率提升了 12%，值得试试。"},
        used_rag=True,
    )
    assert not errs
