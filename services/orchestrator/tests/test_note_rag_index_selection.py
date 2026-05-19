from app.rag_core import join_chunks_for_summary, select_chunks_for_index


def test_select_chunks_head_truncates_from_start():
    import os

    chunks = [f"chunk-{i}-" + ("x" * 100) for i in range(20)]
    metas = [{"i": i} for i in range(20)]
    old = os.environ.get("NOTE_RAG_INDEX_STRATEGY")
    os.environ["NOTE_RAG_INDEX_STRATEGY"] = "head"
    try:
        sel, sel_meta, stats = select_chunks_for_index(chunks, metas, abs_cap=8)
    finally:
        if old is None:
            os.environ.pop("NOTE_RAG_INDEX_STRATEGY", None)
        else:
            os.environ["NOTE_RAG_INDEX_STRATEGY"] = old
    assert len(sel) == 8
    assert sel[0].startswith("chunk-0-")
    assert sel[-1].startswith("chunk-7-")
    assert stats["ragIndexTruncated"] is True
    assert stats["ragChunksTotal"] == 20
    assert stats["ragChunksIndexed"] == 8


def test_select_chunks_head_tail_includes_ends():
    chunks = [f"c{i}" for i in range(30)]
    metas = [{} for _ in range(30)]
    sel, _, stats = select_chunks_for_index(chunks, metas, abs_cap=10)
    # strategy defaults to head unless env set — patch via monkeypatch
    import os

    old = os.environ.get("NOTE_RAG_INDEX_STRATEGY")
    os.environ["NOTE_RAG_INDEX_STRATEGY"] = "head_tail"
    try:
        sel2, _, stats2 = select_chunks_for_index(chunks, metas, abs_cap=10)
    finally:
        if old is None:
            os.environ.pop("NOTE_RAG_INDEX_STRATEGY", None)
        else:
            os.environ["NOTE_RAG_INDEX_STRATEGY"] = old
    assert stats2["ragIndexStrategy"] == "head_tail"
    assert "c0" in sel2[0]
    assert any(s.startswith("c2") for s in sel2[-3:])


def test_select_chunks_per_chapter_balances():
    import os

    chunks = [f"c{i}" for i in range(24)]
    metas = [{"chapter_id": f"c{i // 6}"} for i in range(24)]
    old = os.environ.get("NOTE_RAG_INDEX_STRATEGY")
    os.environ["NOTE_RAG_INDEX_STRATEGY"] = "per_chapter"
    try:
        sel, _, stats = select_chunks_for_index(chunks, metas, abs_cap=12)
    finally:
        if old is None:
            os.environ.pop("NOTE_RAG_INDEX_STRATEGY", None)
        else:
            os.environ["NOTE_RAG_INDEX_STRATEGY"] = old
    assert len(sel) == 12
    assert stats["ragIndexStrategy"] == "per_chapter"
    assert stats.get("chaptersInIndex", 0) >= 3


def test_join_chunks_for_summary_respects_cap():
    chunks = ["a" * 5000, "b" * 5000, "c" * 5000]
    joined = join_chunks_for_summary(chunks, max_chars=8000)
    assert len(joined) <= 8000
    assert "aaa" in joined
