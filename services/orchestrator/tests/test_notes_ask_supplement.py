from app.notes_ask_supplement import (
    answer_signals_material_gap,
    is_discard_supplement_text,
    sanitize_supplement_answer,
    should_run_supplement_stage,
)


def test_should_run_supplement_on_low_confidence():
    assert should_run_supplement_stage(
        corpus_answer="根据资料……",
        qa_plan={"lowConfidence": True},
    )


def test_should_not_run_when_disabled():
    import os

    os.environ["NOTES_ASK_SUPPLEMENT"] = "0"
    try:
        assert not should_run_supplement_stage(
            corpus_answer="材料中未提及",
            qa_plan={"lowConfidence": True},
        )
    finally:
        os.environ.pop("NOTES_ASK_SUPPLEMENT", None)


def test_should_not_run_shared_read_only():
    assert not should_run_supplement_stage(
        corpus_answer="材料中未提及",
        qa_plan={"lowConfidence": True},
        shared_read_only=True,
    )


def test_material_gap_signal():
    assert answer_signals_material_gap("摘录中看不到相关记载。")
    assert not answer_signals_material_gap("因此结论是肯定的。[1]")


def test_sanitize_skips_no_supplement():
    assert sanitize_supplement_answer("资料已足够回答，无需补充。") == ""


def test_discard_marker_and_heading_skip():
    assert is_discard_supplement_text("[[NO_SUPPLEMENT]]")
    assert is_discard_supplement_text(
        "## 补充说明（非资料原文，仅供参考）\n\n资料已足够回答，无需补充。"
    )


def test_sanitize_adds_heading():
    out = sanitize_supplement_answer("这是通识解释。")
    assert "通识参考" in out
    assert "非资料原文" in out


def test_should_run_on_short_context():
    assert should_run_supplement_stage(
        corpus_answer="根据现有摘录……",
        qa_plan={"contextChars": 600, "retrievalChunksMeta": [{"score": 0.2}]},
    )


def test_legacy_heading_normalized():
    out = sanitize_supplement_answer(
        "## 补充说明（非资料原文，仅供参考）\n\n- 通识要点一"
    )
    assert out.startswith("## 通识参考")
