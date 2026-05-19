from unittest.mock import patch

from app.note_studio import _context_from_note


def test_context_from_note_empty_without_summary():
    row = {"id": "x", "metadata": {}, "content_text": "hi"}
    with patch("app.note_studio.list_shards", return_value=[]):
        assert _context_from_note(row).strip() == ""


def test_context_from_note_includes_l0():
    row = {"id": "x", "metadata": {"bookSummaryL0": "全书要点"}, "content_text": "hi"}
    with patch("app.note_studio.list_shards", return_value=[]):
        ctx = _context_from_note(row)
    assert "全书要点" in ctx
