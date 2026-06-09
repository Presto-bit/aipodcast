from app.studio.agent_route import build_compose_task_sentence, route_studio_agent


def test_compose_task_sentence_filters_ask_only_turns():
    turns = [
        {"role": "user", "content": "开头钩子怎么写更抓人"},
        {"role": "assistant", "content": "可以用场景+痛点问句…"},
        {
            "role": "user",
            "content": "我想创作小红书，推广杯子，主打职场女性，提醒喝水",
        },
    ]
    task = build_compose_task_sentence(
        turns,
        current_message="我想创作小红书，推广杯子，主打职场女性，提醒喝水",
    )
    assert "开头钩子" not in task
    assert "推广杯子" in task


def test_compose_routes_after_ask_then_promo_brief():
    turns = [
        {"role": "user", "content": "开头钩子怎么写更抓人"},
        {
            "role": "user",
            "content": "我想创作小红书，推广杯子，主打职场女性，提醒喝水",
        },
    ]
    task = build_compose_task_sentence(turns, current_message=turns[-1]["content"])
    tool = route_studio_agent(
        message=turns[-1]["content"],
        status="draft",
        version_count=0,
        task_sentence=task,
    )
    assert tool == "compose"


def test_ready_length_constraint_routes_revise():
    tool = route_studio_agent(
        message="写500字",
        status="ready",
        version_count=1,
        task_sentence="推广水杯",
    )
    assert tool == "revise"


def test_ready_explicit_ask_routes_reply():
    tool = route_studio_agent(
        message="这段为什么这样写？",
        status="ready",
        version_count=1,
        task_sentence="推广水杯",
    )
    assert tool == "reply"
