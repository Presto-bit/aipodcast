from app.rag_core import split_segments_into_chunks_with_meta


def test_split_segments_inherit_meta():
    segs = [
        {"text": "第一节\n\n" + ("内容句子。" * 400), "meta": {"heading_path": ["第一章", "第一节"], "block_type": "paragraph"}},
        {"text": "| a | b |\n| --- | --- |\n| 1 | 2 |", "meta": {"block_type": "table"}},
    ]
    pairs = split_segments_into_chunks_with_meta(segs, max_chunk_chars=500, overlap=40)
    assert pairs
    assert any("第一章" in str(p[1].get("heading_path") or []) for p in pairs)
    assert any(p[1].get("block_type") == "table" for p in pairs)
