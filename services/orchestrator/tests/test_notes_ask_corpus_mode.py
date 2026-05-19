from app.note_corpus import detect_corpus_mode


def test_detect_corpus_mode_compare():
    assert detect_corpus_mode(["a", "b"], "A 和 B 的区别", total_chars=10_000) == "multi_compare"


def test_detect_corpus_mode_per_note_many():
    assert detect_corpus_mode(["a", "b", "c", "d"], "某个细节", total_chars=10_000) == "per_note"


def test_detect_corpus_mode_synthesize():
    assert detect_corpus_mode(["a", "b"], "帮我总结", total_chars=10_000) == "multi_synthesize"
