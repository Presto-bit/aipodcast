"""onboarding_starter 单元测试（无 DB 时跳过需库用例）。"""

from app.onboarding_starter import ONBOARDING_NOTEBOOK_NAME, _STARTER_NOTES, _total_note_count


def test_starter_notebook_name():
    assert ONBOARDING_NOTEBOOK_NAME == "快速上手"


def test_starter_notes_nonempty():
    assert len(_STARTER_NOTES) >= 2
    for title, body in _STARTER_NOTES:
        assert title.strip()
        assert body.strip()


def test_total_note_count():
    assert _total_note_count({}) == 0
    assert _total_note_count({"a": {"note_count": 2}, "b": {"note_count": 1}}) == 3
