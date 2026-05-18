"""答后 followUpQuestion 解析。"""
from app.notes_ask_style import parse_followup_json


def test_parse_followup_json_object():
    raw = '{"followUpQuestion":"若边界条件不成立，第一步应如何调整？"}'
    assert parse_followup_json(raw) == "若边界条件不成立，第一步应如何调整？"


def test_parse_followup_json_empty():
    assert parse_followup_json('{"followUpQuestion":""}') == ""


def test_parse_followup_json_snake_case():
    raw = '{"follow_up_question":"对比两种方案的适用场景"}'
    assert "对比" in parse_followup_json(raw)
