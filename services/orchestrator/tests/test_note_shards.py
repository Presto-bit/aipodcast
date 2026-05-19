from app.note_shards import (
    ShardSpan,
    assign_shard_ids_to_chunks,
    detect_shards,
)
from app.rag_core import note_rag_index_strategy, select_chunks_for_index


def test_detect_shards_single_short():
    body = "a" * 10_000
    spans = detect_shards(body)
    assert len(spans) == 1
    assert spans[0].shard_id == "s0"


def test_detect_shards_fixed_window_long():
    body = "x" * 250_000
    spans = detect_shards(body)
    assert len(spans) >= 2
    assert spans[0].char_start == 0
    assert spans[-1].char_end == len(body)


def test_assign_shard_ids_to_chunks():
    shards = [
        ShardSpan("s0", "第 1 部分", 0, 100, "fixed_window", 0),
        ShardSpan("s1", "第 2 部分", 100, 200, "fixed_window", 1),
    ]
    chunks = ["a" * 50, "b" * 50, "c" * 50, "d" * 50]
    metas = assign_shard_ids_to_chunks(chunks, [{} for _ in chunks], shards)
    assert metas[0].get("shard_id") == "s0"
    assert metas[-1].get("shard_id") == "s1"


def test_select_chunks_per_shard_strategy():
    assert note_rag_index_strategy() == "per_shard" or note_rag_index_strategy() in (
        "per_shard",
        "per_chapter",
    )
    chunks = [f"c{i}" for i in range(40)]
    metas = [{"shard_id": "s0"}] * 20 + [{"shard_id": "s1"}] * 20
    sel, _, stats = select_chunks_for_index(chunks, metas, 24)
    assert len(sel) == 24
    assert stats.get("ragIndexStrategy") in ("per_shard", "per_chapter", "head", "head_tail")
