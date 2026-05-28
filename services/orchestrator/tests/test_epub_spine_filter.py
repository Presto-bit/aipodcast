"""EPUB spine 过滤与 NCX 章节名。"""

from __future__ import annotations

import io
import zipfile

from app.fyv_shared.content_parser import ContentParser, _epub_should_skip_spine


def _epub_with_spine(*files: tuple[str, str]) -> bytes:
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
    manifest = "\n".join(
        f'    <item id="f{i}" href="{href}" media-type="application/xhtml+xml"/>'
        for i, (href, _) in enumerate(files)
    )
    spine = "\n".join(f'    <itemref idref="f{i}"/>' for i in range(len(files)))
    opf = f"""<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <manifest>
{manifest}
  </manifest>
  <spine>
{spine}
  </spine>
</package>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("content.opf", opf)
        for i, (href, html) in enumerate(files):
            zf.writestr(href, html)
    return buf.getvalue()


def test_epub_should_skip_empty_part_file() -> None:
    assert _epub_should_skip_spine("part0000.xhtml", "part0000", "", []) is True


def test_epub_parse_skips_boilerplate_spine(tmp_path) -> None:
    data = _epub_with_spine(
        (
            "part0000.xhtml",
            "<html><body><p> </p></body></html>",
        ),
        (
            "ch1.xhtml",
            "<html><body><h1>正文章</h1><p>内容。</p></body></html>",
        ),
    )
    path = tmp_path / "t.epub"
    path.write_bytes(data)
    r = ContentParser().parse_epub(str(path))
    assert r.get("success") is True
    content = str(r.get("content") or "")
    assert "part0000" not in content.lower()
    assert "## 正文章" in content
