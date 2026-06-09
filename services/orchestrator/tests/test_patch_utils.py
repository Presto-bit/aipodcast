from app.studio.patch_utils import build_pending_patch_payload, infer_patch_scope


def test_title_only_scope():
    scopes = infer_patch_scope("只改标题更犀利")
    assert "title" in scopes


def test_length_constraint_scope():
    scopes = infer_patch_scope("写500字")
    assert "body" in scopes


def test_pending_patch_title_only():
    base = [
        {"id": "t1", "kind": "title", "text": "旧标题"},
        {"id": "b1", "kind": "body", "text": "正文不变"},
    ]
    proposed = [
        {"id": "t1", "kind": "title", "text": "新标题"},
        {"id": "b1", "kind": "body", "text": "正文被模型乱改"},
    ]
    patch = build_pending_patch_payload(
        from_version_id="v1",
        from_blocks=base,
        proposed_blocks=proposed,
        message="只改标题",
        reason="用户要求",
        source_run_id="r1",
    )
    assert patch["changedKeys"] == ["title:0"]
    body = next(b for b in patch["proposedBlocks"] if b["kind"] == "body")
    assert body["text"] == "正文不变"
