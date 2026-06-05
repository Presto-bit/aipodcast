from app.studio.agent_tool_router import (
    StudioToolDecision,
    _apply_mode_guard,
    _reconcile_decision,
    _sanitize_brief,
    resolve_studio_agent_tool,
)


def test_sanitize_brief_rejects_hook_tutorial_brief():
    turns = [
        {"role": "user", "content": "开头钩子怎么写更抓人"},
        {"role": "user", "content": "我想创作小红书，推广杯子，主打职场女性，提醒喝水"},
    ]
    llm_brief = "今天拆解杯子推广的开头钩子写法，第一步第二步"
    brief = _sanitize_brief(
        turns=turns,
        current_message=turns[-1]["content"],
        llm_brief=llm_brief,
    )
    assert "推广杯子" in brief
    assert "第一步" not in brief


def test_reconcile_compose_after_hook_question():
    turns = [
        {"role": "user", "content": "开头钩子怎么写更抓人"},
        {"role": "user", "content": "我想创作小红书，推广杯子，主打职场女性，提醒喝水"},
    ]
    message = turns[-1]["content"]
    rule = StudioToolDecision(
        tool="compose",
        brief="我想创作小红书，推广杯子，主打职场女性，提醒喝水",
        reply_text="",
        source="rules",
        reason="规则：compose",
    )
    llm = {
        "tool": "compose",
        "brief": "我想创作小红书，推广杯子，主打职场女性，提醒喝水",
        "reply": "",
    }
    out = _reconcile_decision(
        rule=rule,
        llm=llm,
        message=message,
        status="draft",
        version_count=0,
        turns=turns,
    )
    assert out.tool == "compose"
    assert "推广杯子" in out.brief
    assert "开头钩子" not in out.brief


def test_reconcile_blocks_compose_for_ask_only():
    rule = StudioToolDecision(
        tool="reply",
        brief="",
        reply_text="",
        source="rules",
        reason="规则：问答",
    )
    llm = {
        "tool": "compose",
        "brief": "开头钩子写法",
        "reply": "",
    }
    out = _reconcile_decision(
        rule=rule,
        llm=llm,
        message="开头钩子怎么写更抓人",
        status="draft",
        version_count=0,
        turns=[{"role": "user", "content": "开头钩子怎么写更抓人"}],
    )
    assert out.tool == "reply"


def test_ask_mode_blocks_compose():
    decision = StudioToolDecision(
        tool="compose",
        brief="推广杯子",
        reply_text="",
        source="rules",
        reason="规则：compose",
    )
    out = _apply_mode_guard(
        decision,
        agent_mode="ask",
        message="我想创作小红书，推广杯子，主打职场女性，提醒喝水",
    )
    assert out.tool == "reply"
    assert "写稿" in out.reply_text or "问答" in out.reply_text


def test_ask_mode_resolve_skips_compose():
    turns = [
        {
            "role": "user",
            "content": "我想创作小红书，推广杯子，主打职场女性，提醒喝水",
        }
    ]
    out = resolve_studio_agent_tool(
        message=turns[0]["content"],
        status="draft",
        version_count=0,
        turns=turns,
        agent_mode="ask",
    )
    assert out.tool == "reply"

