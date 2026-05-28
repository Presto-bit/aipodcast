"""
EPUB 目录（EPUB3 nav / NCX）解析与按锚点切分章节正文。

仅一级 navPoint / nav TOC 项作为「书籍章节」；正文边界由 href#fragment 决定，而非整份 xhtml。
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote

from bs4 import BeautifulSoup, Tag

# guide / nav epub:type：非正文章节
_LANDMARK_TYPES = frozenset(
    {
        "cover",
        "title-page",
        "toc",
        "copyright-page",
        "copyright",
        "dedication",
        "acknowledgments",
        "contributors",
        "epigraph",
        "foreword",
        "preface",
        "prologue",
        "afterword",
        "bibliography",
        "index",
        "glossary",
        "loi",
        "lot",
        "landmarks",
        "page-list",
        "frontmatter",
        "backmatter",
        "colophon",
        "imprint",
    }
)

_BLOCK_TAGS = frozenset({"h1", "h2", "h3", "p", "li", "div", "table", "img"})


@dataclass(frozen=True)
class EpubTocEntry:
    """一级目录项：标题 + 包内路径 + 可选锚点。"""

    title: str
    path: str
    fragment: str
    landmark: bool = False


def epub_resolve_href(opf_dir: str, href: str) -> tuple[str, str]:
    raw = unquote((href or "").strip())
    if "#" in raw:
        path_part, frag = raw.split("#", 1)
    else:
        path_part, frag = raw, ""
    path_part = path_part.replace("\\", "/").lstrip("/")
    if opf_dir and path_part and not path_part.startswith(opf_dir + "/"):
        full = f"{opf_dir}/{path_part}".replace("\\", "/")
    else:
        full = path_part or ""
    return full.replace("\\", "/"), frag.strip()


def epub_landmark_paths(opf_root: ET.Element, opf_dir: str) -> set[str]:
    """OPF guide reference 与常见非正文路径。"""
    out: set[str] = set()
    for ref in opf_root.findall(".//{*}guide/{*}reference"):
        typ = (ref.attrib.get("type") or "").strip().lower()
        href = (ref.attrib.get("href") or "").strip()
        if not href:
            continue
        path, _ = epub_resolve_href(opf_dir, href)
        if path:
            out.add(path)
        if typ in _LANDMARK_TYPES:
            out.add(path)
    return out


def _li_epub_types(li: Tag) -> set[str]:
    raw = str(li.get("epub:type") or li.get("type") or "").strip().lower()
    return {x for x in re.split(r"\s+", raw) if x}


def _is_landmark_li(li: Tag | None) -> bool:
    if li is None:
        return False
    types = _li_epub_types(li)
    if types & _LANDMARK_TYPES:
        return True
    if types and "chapter" not in types and "bodymatter" not in types and "part" not in types:
        # 仅有未知 type 时不一律丢弃
        if types <= _LANDMARK_TYPES:
            return True
    return False


def _parse_epub3_nav_toc(soup: BeautifulSoup, opf_dir: str) -> list[EpubTocEntry]:
    entries: list[EpubTocEntry] = []
    for nav in soup.find_all("nav"):
        epub_type = str(nav.get("epub:type") or nav.get("type") or "").lower()
        role = str(nav.get("role") or "").lower()
        if "toc" not in epub_type.split() and role != "doc-toc":
            continue
        ol = nav.find("ol", recursive=False)
        if ol is None:
            ol = nav.find("ol")
        if ol is None:
            continue
        for li in ol.find_all("li", recursive=False):
            a = li.find("a", href=True)
            if a is None:
                continue
            title = a.get_text(" ", strip=True)
            href = str(a.get("href") or "").strip()
            if not title or not href:
                continue
            path, frag = epub_resolve_href(opf_dir, href)
            if not path:
                continue
            entries.append(
                EpubTocEntry(
                    title=title[:240],
                    path=path,
                    fragment=frag,
                    landmark=_is_landmark_li(li),
                )
            )
        if entries:
            break
    return entries


def epub_load_nav_toc_entries(
    zf: zipfile.ZipFile,
    opf_root: ET.Element,
    opf_dir: str,
    manifest: dict[str, str],
) -> list[EpubTocEntry]:
    """优先 EPUB3 nav 文档，其次 NCX 一级 navPoint。"""
    nav_href = ""
    for item in opf_root.findall(".//{*}manifest/{*}item"):
        props = (item.attrib.get("properties") or "").split()
        if "nav" in props:
            nav_href = (item.attrib.get("href") or "").strip()
            break
    if nav_href:
        nav_path, _ = epub_resolve_href(opf_dir, nav_href)
        try:
            html = zf.read(nav_path).decode("utf-8", errors="ignore")
            soup = BeautifulSoup(html, "html.parser")
            nav3 = _parse_epub3_nav_toc(soup, opf_dir)
            if nav3:
                return nav3
        except KeyError:
            pass

    return epub_ncx_top_level_entries(zf, opf_root, opf_dir)


def epub_ncx_top_level_entries(
    zf: zipfile.ZipFile,
    opf_root: ET.Element,
    opf_dir: str,
) -> list[EpubTocEntry]:
    """仅 navMap 下直接子 navPoint（一级目录）。"""
    ncx_href = ""
    for item in opf_root.findall(".//{*}manifest/{*}item"):
        if (item.attrib.get("media-type") or "").strip().lower() == "application/x-dtbncx+xml":
            ncx_href = (item.attrib.get("href") or "").strip()
            break
    if not ncx_href:
        return []
    ncx_path, _ = epub_resolve_href(opf_dir, ncx_href)
    try:
        ncx_xml = zf.read(ncx_path).decode("utf-8", errors="ignore")
    except KeyError:
        return []
    try:
        root = ET.fromstring(ncx_xml)
    except ET.ParseError:
        return []
    nav_map = root.find(".//{*}navMap")
    if nav_map is None:
        return []
    entries: list[EpubTocEntry] = []
    for np in nav_map.findall("./{*}navPoint"):
        label_el = np.find(".//{*}navLabel/{*}text")
        content_el = np.find("./{*}content")
        if label_el is None or content_el is None:
            continue
        title = (label_el.text or "").strip()
        src = (content_el.attrib.get("src") or "").strip()
        if not title or len(title) < 1 or not src:
            continue
        path, frag = epub_resolve_href(opf_dir, src)
        if not path:
            continue
        entries.append(EpubTocEntry(title=title[:240], path=path, fragment=frag, landmark=False))
    return entries


def filter_toc_entries(
    entries: list[EpubTocEntry],
    landmark_paths: set[str],
) -> list[EpubTocEntry]:
    out: list[EpubTocEntry] = []
    for e in entries:
        if e.landmark:
            continue
        if e.path in landmark_paths and not e.fragment:
            continue
        base = e.path.rsplit("/", 1)[-1].lower()
        if base in ("nav.xhtml", "toc.xhtml", "cover.xhtml") and not e.fragment:
            continue
        out.append(e)
    return out


def _find_fragment_start(soup: BeautifulSoup, fragment: str) -> Tag | None:
    if not fragment:
        body = soup.body or soup
        return body if isinstance(body, Tag) else None
    frag = fragment.lstrip("#")
    for sel in (f"[id='{frag}']", f"[name='{frag}']"):
        try:
            el = soup.select_one(sel)
            if el is not None:
                return el
        except Exception:
            pass
    el = soup.find(id=frag)
    if el is not None:
        return el
    return soup.find(attrs={"name": frag})


def _linear_block_tags(soup: BeautifulSoup) -> list[Tag]:
    root = soup.body or soup
    return [el for el in root.find_all(list(_BLOCK_TAGS)) if isinstance(el, Tag)]


def _tags_in_chapter_range(
    soup: BeautifulSoup,
    start_fragment: str,
    end_fragment: str | None,
) -> list[Tag]:
    """同一 xhtml 内 [start, end) 锚点之间的块级节点。"""
    tags = _linear_block_tags(soup)
    if not tags:
        return []
    start_el = _find_fragment_start(soup, start_fragment)
    end_el = _find_fragment_start(soup, end_fragment) if end_fragment else None

    start_idx = 0
    if start_fragment and start_el is not None:
        for i, t in enumerate(tags):
            if t is start_el or start_el in t.parents:
                start_idx = i
                break

    end_idx = len(tags)
    if end_fragment and end_el is not None:
        for i, t in enumerate(tags):
            if t is end_el or end_el in t.parents:
                end_idx = i
                break
        if end_idx <= start_idx:
            end_idx = len(tags)

    return tags[start_idx:end_idx]


def epub_collect_html_blocks_for_path(
    zf: zipfile.ZipFile,
    path: str,
    start_fragment: str = "",
    end_fragment: str | None = None,
    extract_blocks_fn: Any = None,
) -> list[dict[str, Any]]:
    """读取单文件并按锚点截取，再交给 extract_blocks_fn(soup scoped)。"""
    try:
        html = zf.read(path).decode("utf-8", errors="ignore")
    except KeyError:
        return []
    soup = BeautifulSoup(html, "html.parser")
    for bad in soup(["script", "style", "noscript"]):
        bad.decompose()

    if not start_fragment and not end_fragment:
        return extract_blocks_fn(soup, None) if extract_blocks_fn else []

    scoped_tags = _tags_in_chapter_range(soup, start_fragment, end_fragment or "")
    if not scoped_tags:
        if start_fragment:
            return []
        return extract_blocks_fn(soup, None) if extract_blocks_fn else []

    return extract_blocks_fn(soup, scoped_tags) if extract_blocks_fn else []


def epub_chapter_html_blocks(
    zf: zipfile.ZipFile,
    spine_paths: list[str],
    entry: EpubTocEntry,
    next_entry: EpubTocEntry | None,
    extract_blocks_fn: Any,
) -> list[dict[str, Any]]:
    """
    按目录项与下一项之间的 spine 范围收集块：
    - 同文件：锚点 [frag_start, frag_end)
    - 跨文件：起始文件 frag_start→EOF，中间 spine 整文件，末文件 BOF→frag_end
    """
    norm_spine = [p.replace("\\", "/") for p in spine_paths]
    path = entry.path.replace("\\", "/")
    try:
        si = norm_spine.index(path)
    except ValueError:
        return epub_collect_html_blocks_for_path(
            zf, path, entry.fragment, None, extract_blocks_fn
        )

    if next_entry is None:
        paths = norm_spine[si:]
        frags_start = [entry.fragment] + [""] * (len(paths) - 1)
        frags_end: list[str | None] = [None] * len(paths)
    else:
        next_path = next_entry.path.replace("\\", "/")
        try:
            ei = norm_spine.index(next_path)
        except ValueError:
            ei = si
        if next_path == path:
            paths = [path]
            frags_start = [entry.fragment]
            frags_end = [next_entry.fragment]
        elif ei > si:
            paths = norm_spine[si : ei + 1]
            frags_start = [entry.fragment] + [""] * (len(paths) - 1)
            frags_end = [None] * (len(paths) - 1) + [next_entry.fragment]
        else:
            paths = [path]
            frags_start = [entry.fragment]
            frags_end = [next_entry.fragment]

    blocks: list[dict[str, Any]] = []
    for p, fs, fe in zip(paths, frags_start, frags_end):
        part = epub_collect_html_blocks_for_path(zf, p, fs, fe, extract_blocks_fn)
        blocks.extend(part)
    return blocks
