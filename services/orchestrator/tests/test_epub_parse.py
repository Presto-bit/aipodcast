"""EPUB 笔记解析：章节标题与 rag_segments。"""

from __future__ import annotations

import io
import zipfile

from bs4 import BeautifulSoup

from app.fyv_shared.content_parser import ContentParser


def _minimal_epub_bytes(*, chapter_html: str, title: str = "第一章") -> bytes:
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
    opf = """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>"""
    xhtml = f"""<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{title}</title></head>
<body>{chapter_html}</body>
</html>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("content.opf", opf)
        zf.writestr("ch1.xhtml", xhtml)
    return buf.getvalue()


def test_epub_chapter_title_from_soup_prefers_h1() -> None:
    soup = BeautifulSoup("<html><head><title>T</title></head><body><h1>正文标题</h1></body></html>", "html.parser")
    assert ContentParser._epub_chapter_title_from_soup(soup, "ch1.xhtml") == "正文标题"


def test_epub_parse_inserts_markdown_headings_and_segments(tmp_path) -> None:
    data = _minimal_epub_bytes(
        title="扉页",
        chapter_html="<h1>开篇</h1><p>段落一。</p><p>段落二。</p>",
    )
    epub_path = tmp_path / "t.epub"
    epub_path.write_bytes(data)
    r = ContentParser().parse_epub(str(epub_path))
    assert r.get("success") is True
    content = str(r.get("content") or "")
    assert "## 开篇" in content
    assert "段落一" in content
    assert "段落二" in content
    assert "\n\n段落一" in content or "段落一。\n\n段落二" in content
    segs = r.get("rag_segments")
    assert isinstance(segs, list) and len(segs) >= 2
    para_segs = [s for s in segs if (s.get("meta") or {}).get("block_type") == "paragraph"]
    assert len(para_segs) >= 2
    assert para_segs[0].get("text") == "段落一。"
    assert (para_segs[0].get("meta") or {}).get("heading_path") == ["开篇"]
