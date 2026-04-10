from app.show_notes_convert import markdown_show_notes_to_html, plain_summary_fallback_from_markdown


def test_timestamp_link_becomes_span():
    md = "跳转 [2:30](t:150) 继续"
    html = markdown_show_notes_to_html(md)
    assert "fyv-ts" in html
    assert 'data-sec="150"' in html
    assert "2:30" in html


def test_external_link_kept():
    md = "[官网](https://example.com/path)"
    html = markdown_show_notes_to_html(md)
    assert "https://example.com/path" in html
    assert 'rel="noopener noreferrer"' in html or "noopener" in html


def test_plain_summary_fallback():
    s = plain_summary_fallback_from_markdown("# 标题\n\n正文第一行很长" + "x" * 600)
    assert "正文" in s
    assert len(s) <= 481
