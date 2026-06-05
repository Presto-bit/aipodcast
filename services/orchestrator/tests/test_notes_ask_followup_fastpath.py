from app.notes_ask import is_notes_ask_followup


def test_is_notes_ask_followup_empty() -> None:
    assert is_notes_ask_followup(None, None) is False
    assert is_notes_ask_followup([], None) is False


def test_is_notes_ask_followup_chat_history() -> None:
    assert is_notes_ask_followup([{"role": "user", "content": "你好"}], None) is True


def test_is_notes_ask_followup_session_state() -> None:
    state = {"v": 1, "topic": "小红书清单", "turnCursor": 0, "threads": [], "facts": []}
    assert is_notes_ask_followup(None, state) is True


def test_is_notes_ask_followup_turn_cursor() -> None:
    state = {"v": 1, "topic": "", "turnCursor": 2, "threads": [], "facts": []}
    assert is_notes_ask_followup(None, state) is True
