from bs4 import BeautifulSoup

from app.fyv_shared.content_parser import (
    _extract_links_for_list_page,
    _detect_page_kind,
    _extract_semantic_text,
    _is_js_shell_html,
    _score_content_quality,
    _should_try_js_render,
    _strip_chrome_layout,
    _strip_noise_by_attr,
)


def test_detect_page_kind_doc_by_path():
    soup = BeautifulSoup("<html><body><main><h1>API 文档</h1><p>说明</p></main></body></html>", "html.parser")
    kind = _detect_page_kind("https://example.com/docs/intro", soup, "API 文档\n说明")
    assert kind == "doc"


def test_extract_semantic_text_removes_noise():
    html = """
    <html><body>
      <header>登录 注册</header>
      <main>
        <h1>这是文章标题</h1>
        <p>这是正文第一段，包含关键观点和背景信息。</p>
        <p>这是正文第二段，继续展开细节。</p>
      </main>
      <footer>隐私政策</footer>
    </body></html>
    """
    soup = BeautifulSoup(html, "html.parser")
    _strip_chrome_layout(soup)
    _strip_noise_by_attr(soup)
    text = _extract_semantic_text(soup)
    assert "这是文章标题" in text
    assert "正文第一段" in text
    assert "隐私政策" not in text


def test_quality_score_prefers_dense_content():
    high = "标题\n" + "\n".join(["这是一段较长的正文内容，具有完整语义和较低噪音。"] * 15)
    low = "登录\n注册\n隐私政策\n上一篇\n下一篇"
    high_score, _ = _score_content_quality(high, page_kind="article")
    low_score, _ = _score_content_quality(low, page_kind="list")
    assert high_score > low_score
    assert high_score > 0.3


def test_js_shell_html_detection():
    scripts = "".join(["<script>var a=1;</script>" for _ in range(15)])
    html = f"<html><body><div id='__next'></div>{scripts}</body></html>"
    assert _is_js_shell_html(html, "登录")


def test_should_try_js_render_for_low_score():
    scripts = "".join(["<script>var a=1;</script>" for _ in range(14)])
    html = f"<html><body><div id='app'></div>{scripts}</body></html>"
    yes = _should_try_js_render(best_score=0.1, html=html, content="登录", host="example.com")
    no = _should_try_js_render(best_score=0.8, html="<html><body><article>正文</article></body></html>", content="正文很多很多", host="example.com")
    assert yes is True
    assert no is False


def test_extract_links_for_list_page():
    html = """
    <html><body>
      <a href="/post/a1">第一篇文章</a>
      <a href="https://example.com/post/a2">第二篇文章</a>
      <a href="#top">返回顶部</a>
    </body></html>
    """
    soup = BeautifulSoup(html, "html.parser")
    links = _extract_links_for_list_page(soup, "https://example.com/list")
    assert len(links) == 2
    assert links[0]["url"].startswith("https://example.com/")
