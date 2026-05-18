"""知识库问答三层改造：题型、动态 top_k、合并块。"""
from app.notes_ask_style import (
    classify_answer_type,
    merge_adjacent_chunks_enabled,
    merge_adjacent_retrieval_picks,
    parse_planner_json,
    resolve_retrieval_top_k,
)


def test_classify_howto():
    assert classify_answer_type("如何配置 nginx 反向代理？") == "howto"


def test_classify_compare():
    assert classify_answer_type("Redis 和 Memcached 的区别") == "compare"


def test_classify_survey():
    assert classify_answer_type("请全面梳理这套架构") == "survey"


def test_dynamic_top_k_howto_smaller_than_cap(monkeypatch):
    monkeypatch.setenv("NOTES_ASK_TOP_K", "56")
    monkeypatch.setenv("NOTES_ASK_DYNAMIC_TOP_K", "1")
    k, t = resolve_retrieval_top_k("怎么部署？")
    assert t == "howto"
    assert k == 32


def test_dynamic_top_k_disabled_uses_cap(monkeypatch):
    monkeypatch.setenv("NOTES_ASK_TOP_K", "40")
    monkeypatch.setenv("NOTES_ASK_DYNAMIC_TOP_K", "0")
    k, _ = resolve_retrieval_top_k("怎么部署？")
    assert k == 40


def test_parse_planner_json_minimal():
    raw = '{"answerType":"concept","thesis":"X 是 Y 的简称","sections":[{"title":"定义","focus":"一句话定义"}]}'
    plan = parse_planner_json(raw)
    assert plan is not None
    assert plan["answerType"] == "concept"
    assert "X 是 Y" in plan["thesis"]


def test_merge_adjacent_picked_chunks_same_note():
    picked = [
        (
            0.9,
            {"note_id": "n1", "chunk_index": 2, "chunk_text": "段落甲"},
        ),
        (
            0.8,
            {"note_id": "n1", "chunk_index": 3, "chunk_text": "段落乙"},
        ),
        (
            0.7,
            {"note_id": "n2", "chunk_index": 0, "chunk_text": "另一笔记"},
        ),
    ]
    merged = merge_adjacent_retrieval_picks(picked)
    assert len(merged) == 2
    assert "段落甲" in merged[0][1]["chunk_text"]
    assert "段落乙" in merged[0][1]["chunk_text"]
    assert merged[0][1].get("_chunk_index_end") == 3


def test_merge_adjacent_enabled_default():
    assert merge_adjacent_chunks_enabled() is True
