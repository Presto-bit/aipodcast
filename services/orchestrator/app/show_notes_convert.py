"""Show Notes：Markdown → RSS 安全 HTML（CDATA），并处理时间戳链接 t:秒。"""

from __future__ import annotations

import re

import markdown

# [文案](t:123) → Markdown 会先变成 <a href="t:123">，再替换为 span，避免非法 scheme
_T_ANCHOR_RE = re.compile(r'<a\s+href="t:(\d+)"([^>]*)>(.*?)</a>', re.IGNORECASE | re.DOTALL)
# http(s) 外链补 rel，与 RSS/CDATA 安全展示及测试契约一致
_EXT_HTTP_ANCHOR_TAG_RE = re.compile(r'<a\s+[^>]*href="(https?://[^"]+)"[^>]*>', re.IGNORECASE)


def _rel_noopener_on_external_links(html: str) -> str:
    s = html or ""
    out: list[str] = []
    last = 0
    for m in _EXT_HTTP_ANCHOR_TAG_RE.finditer(s):
        tag = m.group(0)
        if re.search(r"\brel\s*=", tag, re.IGNORECASE):
            continue
        out.append(s[last : m.start()])
        out.append(tag[:-1] + ' rel="noopener noreferrer">')
        last = m.end()
    out.append(s[last:])
    return "".join(out)


def _fix_timestamp_anchors(html: str) -> str:
    def _sub(m: re.Match[str]) -> str:
        sec = m.group(1)
        inner = m.group(3)
        return f'<span class="fyv-ts" data-sec="{sec}">{inner}</span>'

    return _T_ANCHOR_RE.sub(_sub, html or "")


def markdown_show_notes_to_html(md: str) -> str:
    raw = (md or "").strip()
    if not raw:
        return ""
    html = markdown.markdown(
        raw,
        extensions=["extra", "nl2br", "sane_lists"],
        output_format="html",
    )
    html = _fix_timestamp_anchors(html)
    return _rel_noopener_on_external_links(html)


def rss_cdata_fragment(html: str) -> str:
    """用于 <content:encoded> 的 CDATA 包裹。"""
    safe = (html or "").replace("]]>", "]]]]><![CDATA[>")
    return f"<![CDATA[{safe}]]>"


def plain_summary_fallback_from_markdown(md: str, max_len: int = 480) -> str:
    """从 Markdown 抽一行纯文本作 description 兜底。"""
    for line in (md or "").splitlines():
        t = line.strip()
        if not t:
            continue
        if re.match(r"^#+\s", t):
            continue
        t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
        t = re.sub(r"[`*_~]+", "", t).strip()
        if t:
            return t[:max_len] + ("…" if len(t) > max_len else "")
    return ""
