from app.studio.agent_loop import manuscript_plain_from_payload, run_agent_tool_loop


def test_selection_patch_forces_revise():
    payload = {
        "agentMode": "write",
        "manuscriptBlocks": [
            {"kind": "body", "text": "刚改完方案，一上午没喝水。"},
        ],
    }
    msg = "【块级改版】仅修改 body 块中以下片段：「一上午没喝水」。要求：更口语"
    steps: list[tuple[str, str, str, str | None]] = []

    def emit(step_id: str, label: str, status: str, tool: str | None) -> None:
        steps.append((step_id, label, status, tool))

    result = run_agent_tool_loop(
        message=msg,
        status="ready",
        version_count=1,
        turns=[{"role": "user", "content": msg}],
        payload=payload,
        emit_step=emit,
    )
    assert result.decision.tool == "revise"
    assert any(s[0] == "route" for s in steps)


def test_read_manuscript_builds_excerpt():
    payload = {
        "manuscriptBlocks": [
            {"kind": "title", "text": "职场喝水提醒"},
            {"kind": "body", "text": "正文内容在这里。"},
        ]
    }
    text = manuscript_plain_from_payload(payload)
    assert "职场喝水提醒" in text
    assert "正文内容" in text
