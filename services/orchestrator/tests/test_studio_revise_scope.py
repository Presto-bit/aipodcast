from app.studio.studio_revise_scope import is_local_patch_scope, parse_revise_scope_from_llm


def test_parse_revise_scope_title_only():
    scope = parse_revise_scope_from_llm(
        {"reviseScope": {"blocks": ["title"], "intent": "sharper"}},
        message="把标题改得更犀利",
    )
    assert scope["blocks"] == ["title"]
    assert scope["intent"] == "sharper"
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
