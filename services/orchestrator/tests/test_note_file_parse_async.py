"""方案 B：异步附件解析能力字段。"""
from __future__ import annotations

from app.routes.notes_routes import _derive_preprocess_stage, _derive_source_capabilities


def test_derive_source_capabilities_pending() -> None:
    cap = _derive_source_capabilities(
        input_type="note_file",
        content_text="",
        parse_status="pending",
        parse_detail="",
        parse_engine="",
        rag_chunks=0,
        rag_err="",
        created_at="2026-01-01T00:00:00Z",
        rag_index_at="",
        metadata_parse_state="pending",
        has_file_object=True,
    )
    assert cap["parseState"] == "pending"
    assert cap["parseOk"] is False
    assert cap["sourceReady"] is True
    assert cap["citeState"] == "unavailable"


def test_derive_preprocess_stage_while_parsing() -> None:
    cap = _derive_source_capabilities(
        input_type="note_file",
        content_text="",
        parse_status="pending",
        parse_detail="",
        parse_engine="",
        rag_chunks=0,
        rag_err="",
        created_at="2026-01-01T00:00:00Z",
        rag_index_at="",
        metadata_parse_state="parsing",
        has_file_object=True,
    )
    stage, hint = _derive_preprocess_stage({}, cap)
    assert stage == "解析中"
    assert "解析" in hint
