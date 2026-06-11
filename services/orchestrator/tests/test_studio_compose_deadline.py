from app.studio.studio_planner_utils import compose_stream_deadline_seconds


def test_compose_deadline_long_article_with_corpus():
    deadline = compose_stream_deadline_seconds(
        intake={"_domainTargetChars": 2000},
        domain="article",
        fmt="long_form",
        task_sentence="写一篇科普类型的文章，2000字左右",
        has_corpus=True,
    )
    assert 500 <= deadline <= 900


def test_compose_deadline_short_post():
    deadline = compose_stream_deadline_seconds(
        intake={},
        domain="social",
        fmt="short_post",
        task_sentence="写一条种草",
        has_corpus=False,
    )
    assert 180 <= deadline <= 350
