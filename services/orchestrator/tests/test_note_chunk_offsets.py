from app.note_chunk_offsets import attach_char_offsets_to_chunks


def test_attach_char_offsets_sequential():
    body = "alpha beta gamma"
    chunks = ["alpha", "beta", "gamma"]
    metas = attach_char_offsets_to_chunks(body, chunks, [{} for _ in chunks])
    assert metas[0]["char_start"] == 0
    assert metas[1]["char_start"] == 6
    assert metas[2]["char_start"] == 11
