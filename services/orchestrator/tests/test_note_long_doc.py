from app.note_long_doc import is_long_doc, note_rag_abs_cap_for_body


def test_note_rag_abs_cap_scales_with_body():
    base = note_rag_abs_cap_for_body(0)
    large = note_rag_abs_cap_for_body(500_000)
    assert large > base
    assert large <= 1536


def test_is_long_doc_threshold():
    assert not is_long_doc(100_000)
    assert is_long_doc(250_000)
