from app.note_chapters import (
    COMPARE_QUERY_RE,
    _chapter_scores_from_query,
    assign_chapter_ids_to_chunks,
    chapter_filter_for_query,
    cross_chapter_enabled,
    detect_chapters,
    relative_chapter_intent,
    route_chapters_for_compare,
)


def test_detect_chapters_cn_regex():
    body = "前言\n\n第1章 开端\n\n正文一\n\n第2章 结局\n\n正文二"
    spans = detect_chapters(body)
    assert len(spans) >= 2
    assert spans[0].char_start < spans[1].char_start


def test_assign_chapter_ids_by_offset():
    body = "a" * 5000 + "b" * 5000
    spans = detect_chapters(body)
    chunks = ["a" * 2500, "a" * 2500, "b" * 2500, "b" * 2500]
    metas = assign_chapter_ids_to_chunks(chunks, [{} for _ in chunks], spans)
    ids = {m.get("chapter_id") for m in metas}
    assert len(ids) >= 1


def test_compare_query_re_matches():
    assert COMPARE_QUERY_RE.search("请对比第1章和第2章的区别")
    assert not COMPARE_QUERY_RE.search("第1章讲了什么")


def test_route_chapters_for_compare_empty_without_db(monkeypatch):
    monkeypatch.setenv("NOTES_ASK_CROSS_CHAPTER", "0")
    assert route_chapters_for_compare("fake-note", "对比第1章与第2章") == []


def test_chapter_filter_for_query_empty_ids():
    assert chapter_filter_for_query([], "任意问题") == {}


def test_cross_chapter_enabled_default(monkeypatch):
    monkeypatch.delenv("NOTES_ASK_CROSS_CHAPTER", raising=False)
    assert cross_chapter_enabled() is True


def test_relative_chapter_intent_last():
    assert relative_chapter_intent("请总结最后章节的核心观点") == "last"
    assert relative_chapter_intent("第一章讲了什么") is None


def test_chapter_scores_last_chapter():
    chapters = [
        {"chapter_id": "c0", "title": "第1章 开端", "summary_text": ""},
        {"chapter_id": "c1", "title": "第2章 结局", "summary_text": ""},
    ]
    scored = _chapter_scores_from_query("最后章节讲了什么", chapters)
    assert scored
    assert scored[0][1]["chapter_id"] == "c1"
    assert scored[0][0] >= 0.9
