from app.studio.studio_revise_scope import (
    infer_revise_tier,
    is_local_patch_scope,
    normalize_revise_tier,
    parse_revise_scope_from_llm,
)


def test_parse_revise_scope_title_only():
    scope = parse_revise_scope_from_llm(
        {"reviseScope": {"blocks": ["title"], "intent": "sharper", "tier": "rewrite"}},
        message="把标题改得更犀利",
    )
    assert scope["blocks"] == ["title"]
    assert scope["intent"] == "sharper"
    assert scope["tier"] == "rewrite"
    assert is_local_patch_scope(scope)


def test_full_rewrite_not_local_patch():
    scope = parse_revise_scope_from_llm(
        {"reviseScope": {"blocks": ["body"], "fullRewrite": True}},
        message="重写整篇",
    )
    assert scope["fullRewrite"] is True
    assert not is_local_patch_scope(scope)


def test_selection_snippet_adds_body_scope():
    scope = parse_revise_scope_from_llm({}, message="更口语", selection_snippet="一上午没喝水")
    assert "body" in scope["blocks"]


def test_infer_revise_tier_preserve():
    assert infer_revise_tier("帮我润色一下，别改结构") == "preserve"


def test_infer_revise_tier_rephrase():
    assert infer_revise_tier("降重改写这段") == "rephrase"


def test_infer_revise_tier_rewrite():
    assert infer_revise_tier("重写这段，更口语") == "rewrite"


def test_tier_override_from_payload():
    scope = parse_revise_scope_from_llm({}, message="随便改", tier_override="preserve")
    assert scope["tier"] == "preserve"
    assert normalize_revise_tier("invalid") == "rephrase"
