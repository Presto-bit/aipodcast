from app.note_work_meta import (
    NOTES_SOURCE_TITLES_CAP,
    human_note_source_label,
    snapshot_notes_source_titles,
)


def test_human_note_source_label_uuid():
    assert human_note_source_label("550e8400-e29b-41d4-a716-446655440000") == "未命名笔记"
    assert human_note_source_label("  ") == "未命名笔记"
    assert human_note_source_label("正常标题") == "正常标题"


def test_snapshot_zips_ids_and_titles():
    pl = {
        "selected_note_ids": ["a", "b", "c"],
        "selected_note_titles": ["第一", "第二"],
    }
    assert snapshot_notes_source_titles(pl) == ["第一", "第二", "未命名笔记"]


def test_snapshot_caps_at_limit():
    over = NOTES_SOURCE_TITLES_CAP + 25
    ids = [f"id{i}" for i in range(over)]
    titles = [f"标题{i}" for i in range(over)]
    pl = {"selected_note_ids": ids, "selected_note_titles": titles}
    assert len(snapshot_notes_source_titles(pl)) == NOTES_SOURCE_TITLES_CAP


def test_titles_only_without_ids():
    pl = {"selected_note_titles": ["仅标题", "二"]}
    assert snapshot_notes_source_titles(pl) == ["仅标题", "二"]
