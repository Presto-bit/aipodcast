"""片/章路由：问句规范化、换题解除钉住。"""
from app.note_chapters import _chapter_scores_from_query
from app.note_shards import _shard_scores_from_query
from app.notes_ask_routing import (
    normalize_route_query,
    query_mentions_hint,
    routing_title_hints,
    should_keep_history_route_pin,
)


def test_normalize_route_query_strips_intro_suffix():
    assert normalize_route_query("约翰福音介绍") == "约翰福音"
    assert normalize_route_query("新约四福音关系") == "新约四福音"


def test_routing_title_hints_book_name():
    hints = routing_title_hints("约翰福音 1")
    assert "约翰福音" in hints


def test_shard_scores_john_in_query():
    shards = [
        {"shard_id": "s0", "title": "创世记 1", "summary_text": "创造"},
        {"shard_id": "s42", "title": "约翰福音 1", "summary_text": "道与生命"},
    ]
    scored = _shard_scores_from_query("约翰福音介绍", shards)
    assert scored
    assert scored[0][1]["shard_id"] == "s42"
    assert scored[0][0] >= 0.5


def test_chapter_scores_john_in_query():
    chapters = [
        {"chapter_id": "c0", "title": "创世记 1", "summary_text": ""},
        {"chapter_id": "c99", "title": "约翰福音 1", "summary_text": "太初有道"},
    ]
    scored = _chapter_scores_from_query("约翰福音介绍", chapters)
    assert scored
    assert scored[0][1]["chapter_id"] == "c99"


def test_unpin_when_query_targets_new_book():
    history = [{"noteId": "n1", "shardId": "s0", "title": "创世记 1"}]
    fresh = [
        {"noteId": "n1", "shardId": "s42", "title": "约翰福音 1", "score": 0.72},
        {"noteId": "n1", "shardId": "s0", "title": "创世记 1", "score": 0.1},
    ]
    assert not should_keep_history_route_pin("约翰福音介绍", history, fresh)


def test_keep_pin_on_follow_up():
    history = [{"noteId": "n1", "shardId": "s42", "title": "约翰福音 1"}]
    fresh = [{"noteId": "n1", "shardId": "s0", "title": "创世记 1", "score": 0.4}]
    assert should_keep_history_route_pin("请再详细讲讲", history, fresh)


def test_query_mentions_hint():
    assert query_mentions_hint("约翰福音介绍", "约翰福音")
    assert not query_mentions_hint("创世记内容", "约翰福音")
