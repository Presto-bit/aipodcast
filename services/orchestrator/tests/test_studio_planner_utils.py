from app.studio.agent_tool_router import StudioToolDecision, _reconcile_decision
from app.studio.studio_planner_utils import (
    has_compose_write_intent,
    is_new_draft_intent,
    merge_planner_domain_format,
    target_chars_for_domain,
)


def test_has_compose_write_intent_article():
    assert has_compose_write_intent("写一篇科普 2000 字", "")


def test_is_new_draft_intent():
    assert is_new_draft_intent("另写一篇关于咖啡的科普")


def test_merge_planner_domain_article():
    domain, fmt = merge_planner_domain_format(
        llm_domain="",
        llm_format="",
        hint_domain="general",
        hint_format="general",
        task_sentence="写一篇科普 2000 字",
        message="写一篇科普 2000 字",
    )
    assert domain == "article"
    assert fmt == "long_form"


def test_target_chars_for_domain_article():
    assert target_chars_for_domain("article", "long_form", "写一篇科普 2000 字") == 2000


def test_reconcile_new_draft_compose_with_manuscript():
    rule = StudioToolDecision(
        tool="revise",
        brief="改标题",
        reply_text="",
        source="rules",
        reason="规则",
    )
    llm = {
        "tool": "revise",
        "brief": "改标题",
        "reply": "",
        "assumptions": ["用户要新稿"],
    }
    out = _reconcile_decision(
        rule=rule,
        llm=llm,
        message="另写一篇关于咖啡的笔记",
        status="ready",
        version_count=2,
        turns=[{"role": "user", "content": "另写一篇关于咖啡的笔记"}],
    )
    assert out.tool == "compose"
