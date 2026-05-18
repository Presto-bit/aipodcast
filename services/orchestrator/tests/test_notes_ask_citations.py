"""笔记问答角标合并（collapse_citation_markers）。"""
from app.notes_ask_citations import collapse_citation_markers


def test_collapse_same_citations_in_paragraph_to_last_line():
    raw = (
        "伴侣争吵时可以暂停对话 [1]。\n"
        "情绪升级时应先共情 [1]。\n"
        "修复需要「我们」视角 [1]。"
    )
    out = collapse_citation_markers(raw)
    assert out.count("[1]") == 1
    assert out.endswith("[1]。")
    assert "暂停对话\n" in out


def test_collapse_list_items_same_source():
    raw = (
        "- 先暂停 [1]\n"
        "- 再共情 [1]\n"
        "- 用我们视角 [1]"
    )
    out = collapse_citation_markers(raw)
    assert out.count("[1]") == 1
    assert "我们视角 [1]" in out


def test_preserve_distinct_citation_groups():
    raw = "依恋视角强调连接 [1]。沟通技巧侧重复述 [2]。"
    out = collapse_citation_markers(raw)
    assert "[1]" in out and "[2]" in out


def test_preserve_dual_citation_on_one_line():
    raw = "综合两种材料 [1][2]。"
    out = collapse_citation_markers(raw)
    assert "[1][2]" in out


def test_dedupe_repeated_marker_on_same_line():
    raw = "同一来源 [1][1][1]。"
    out = collapse_citation_markers(raw)
    assert out.endswith("[1]。")
    assert "[1][1]" not in out


def test_separate_paragraph_blocks_keep_one_cite_each():
    """空行分隔的段落视为不同论点块，各自保留一处角标。"""
    raw = "第一点 [1]。\n\n第二点 [1]。"
    out = collapse_citation_markers(raw)
    assert out.count("[1]") == 2

