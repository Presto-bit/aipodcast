from app.legacy_bridge import _line_is_brief_farewell_only, _tail_has_dialogue_farewell, _trim_redundant_dialogue_farewell_leading


def test_tail_has_dialogue_farewell_detects_goodnight_pair():
    acc = "Speaker1: 聊了很多。\nSpeaker2: 晚安，好梦。"
    assert _tail_has_dialogue_farewell(acc) is True


def test_tail_has_dialogue_farewell_detects_goodnight_sentence_end():
    assert _tail_has_dialogue_farewell("…先这样吧。\nSpeaker1: 晚安。") is True


def test_line_brief_farewell_accepts_goodnight_variants():
    assert _line_is_brief_farewell_only("Speaker2: 晚安，好梦。") is True
    assert _line_is_brief_farewell_only("Speaker1: 晚安") is True
    assert _line_is_brief_farewell_only("Speaker2: 好梦。") is True


def test_trim_skips_redundant_farewell_after_goodnight_tail():
    acc = "Speaker2: 晚安，好梦。"
    piece = "Speaker2: 拜拜\nSpeaker1: 接着刚才那点说。"
    out = _trim_redundant_dialogue_farewell_leading(acc, piece)
    assert "拜拜" not in out
    assert "接着刚才" in out
