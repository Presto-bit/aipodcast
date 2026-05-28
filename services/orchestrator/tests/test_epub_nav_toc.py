"""EPUB3 nav / NCX 一级目录与锚点切分。"""

from __future__ import annotations

import io
import zipfile

from app.fyv_shared.content_parser import ContentParser


def _epub_with_epub3_nav() -> bytes:
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
    opf = """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"
         xmlns:epub="http://www.idpf.org/2007/ops">
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch"/>
  </spine>
</package>"""
    nav = """<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
<nav epub:type="toc"><ol>
  <li><a href="ch.xhtml#sec-a">第一节</a></li>
  <li><a href="ch.xhtml#sec-b">第二节</a></li>
</ol></nav>
</body></html>"""
    ch = """<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1 id="sec-a">第一节</h1><p>内容 A。</p>
<h1 id="sec-b">第二节</h1><p>内容 B。</p>
</body></html>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("content.opf", opf)
        zf.writestr("nav.xhtml", nav)
        zf.writestr("ch.xhtml", ch)
    return buf.getvalue()


def test_epub3_nav_two_chapters_by_anchor(tmp_path) -> None:
    path = tmp_path / "nav.epub"
    path.write_bytes(_epub_with_epub3_nav())
    r = ContentParser().parse_epub(str(path))
    assert r.get("success") is True
    content = str(r.get("content") or "")
    assert "## 第一节" in content
    assert "## 第二节" in content
    assert "内容 A" in content and "内容 B" in content
    assert content.count("## 第一节") == 1
    logs = " ".join(r.get("logs") or [])
    assert "nav" in logs.lower() or "NCX" in logs
