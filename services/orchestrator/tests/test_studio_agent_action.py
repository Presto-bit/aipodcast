from app.studio.agent_action import action_to_legacy_tool, resolve_studio_action
from app.studio.lifecycle import derive_studio_lifecycle


def test_lifecycle_empty_ready_without_versions():
    assert derive_studio_lifecycle(status="ready", version_count=0) == "empty"


def test_lifecycle_reviewing_with_pending_patch():
    assert derive_studio_lifecycle(status="ready", version_count=1, has_pending_patch=True) == "reviewing"


def test_promo_brief_creates_when_ready_without_manuscript():
    msg = "编写小红书推广文案，给职场女性推广杯子，可以提醒定时喝水，统计水量"
    action = resolve_studio_action(
        message=msg,
        status="ready",
        version_count=0,
        task_sentence=msg,
    )
    assert action == "create"
    assert action_to_legacy_tool(action) == "compose"


def test_explicit_question_converses():
    action = resolve_studio_action(
        message="这段为什么这样写？",
        status="ready",
        version_count=1,
        task_sentence="推广水杯",
    )
    assert action == "converse"
