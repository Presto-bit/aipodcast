"""
内容解析模块
支持网页解析（BeautifulSoup）和 PDF 解析（PyPDF2）
"""

import logging
import requests
import zipfile
import re
import json
import os
import ipaddress
import html as ihtml
import unicodedata
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag
from typing import Dict, Any

from app.url_fetch_hints import actionable_hint_for_failed_url

from .config import TIMEOUTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 常见 CMS / 博客 / 文档站正文容器（按选择器尝试，取长文本）
_MAIN_CONTENT_SELECTORS: tuple[str, ...] = (
    "article",
    "main",
    '[role="main"]',
    "#article-root",
    "#article",
    "#content",
    "#main-content",
    "#main",
    ".article-content",
    ".post-content",
    ".entry-content",
    ".markdown-body",
    "#cnblogs_post_body",
    ".RichText",
    ".note-content",
    ".article__content",
    "div[itemprop='articleBody']",
)

_NOISE_TEXT_MARKERS: tuple[str, ...] = (
    "cookie",
    "隐私政策",
    "隐私",
    "登录",
    "注册",
    "copyright",
    "版权所有",
    "上一篇",
    "下一篇",
    "推荐阅读",
    "相关阅读",
)

_CONTENT_TAGS: tuple[str, ...] = (
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "li",
    "blockquote",
    "pre",
    "code",
    "table",
)


def _normalize_visible_lines(text: str) -> str:
    lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
    return "\n".join(lines)


def _score_decoded_html_text(text: str) -> tuple[int, int]:
    s = text or ""
    replacement = s.count("\ufffd")
    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    return replacement, -cjk


def _decode_html_response(response: requests.Response) -> str:
    raw = response.content or b""
    if not raw:
        return ""
    candidates: list[str] = []
    ct = str(response.headers.get("content-type") or "")
    m = re.search(r"charset=([A-Za-z0-9._-]+)", ct, flags=re.I)
    if m:
        candidates.append(m.group(1).strip())
    app = str(getattr(response, "apparent_encoding", "") or "").strip()
    if app:
        candidates.append(app)
    req_enc = str(getattr(response, "encoding", "") or "").strip()
    if req_enc:
        candidates.append(req_enc)
    candidates.extend(["utf-8", "gb18030", "gbk", "big5"])
    seen: set[str] = set()
    best = ""
    best_score = (10**9, 0)
    for enc in candidates:
        e = enc.lower()
        if not e or e in seen:
            continue
        seen.add(e)
        try:
            txt = raw.decode(e, errors="replace")
        except Exception:
            continue
        score = _score_decoded_html_text(txt)
        if score < best_score:
            best = txt
            best_score = score
            if score[0] == 0 and score[1] <= -40:
                break
    if not best:
        best = raw.decode("utf-8", errors="replace")
    return best


def _repair_common_mojibake(text: str) -> str:
    s = text or ""
    # UTF-8 被按 latin-1/cp1252 误解码时的常见痕迹。
    weird_markers = (
        "Ã",
        "Â",
        "â€",
        "â€œ",
        "â€\x9d",
        "â€”",
        "å",
        "æ",
        "ç",
        "ï¿½",
    )
    weird_count = sum(s.count(m) for m in weird_markers)
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", s))
    # 文本里异常痕迹很少时不做重解码，避免误伤正常内容。
    if weird_count < 3 and not (weird_count >= 1 and cjk_count <= 3):
        return s
    fixed = ""
    for enc in ("cp1252", "latin-1"):
        try:
            fixed = s.encode(enc, errors="strict").decode("utf-8", errors="strict")
            break
        except Exception:
            continue
    if not fixed:
        try:
            fixed = s.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore")
        except Exception:
            return s
    fixed_cjk = len(re.findall(r"[\u4e00-\u9fff]", fixed))
    # 修复后中文占比明显提升，或异常符号显著减少时采用修复结果。
    fixed_weird = sum(fixed.count(m) for m in weird_markers)
    if fixed_cjk > cjk_count or fixed_weird + 2 < weird_count:
        return fixed
    return s


def _clean_extracted_text(text: str) -> str:
    s = unicodedata.normalize("NFC", str(text or ""))
    s = _strip_nul_chars(s)
    s = _repair_common_mojibake(s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\u00a0", " ").replace("\u200b", "").replace("\ufeff", "")
    # 去除不可见控制字符（保留换行与 tab）
    s = "".join(ch for ch in s if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _strip_script_style(soup: BeautifulSoup) -> None:
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()


def _strip_chrome_layout(soup: BeautifulSoup) -> None:
    for tag in soup(["nav", "footer", "header", "aside", "form"]):
        tag.decompose()


def _strip_noise_by_attr(soup: BeautifulSoup) -> None:
    to_remove: list[Tag] = []
    for tag in soup.find_all(True):
        # decompose 过的节点 attrs/name 可能被置空，跳过避免 NoneType.get 异常
        if not isinstance(getattr(tag, "attrs", None), dict):
            continue
        class_attr = tag.attrs.get("class")
        class_s = " ".join(class_attr) if isinstance(class_attr, list) else str(class_attr or "")
        attrs = " ".join(
            str(x or "")
            for x in (
                tag.attrs.get("id"),
                class_s,
                tag.attrs.get("role"),
                tag.attrs.get("aria-label"),
            )
        ).lower()
        if attrs and any(
            x in attrs for x in ("nav", "footer", "header", "menu", "sidebar", "comment", "related", "ad-")
        ):
            to_remove.append(tag)
    for tag in to_remove:
        try:
            tag.decompose()
        except Exception:
            continue


def _dedupe_lines(text: str) -> str:
    out: list[str] = []
    seen: set[str] = set()
    for line in (text or "").split("\n"):
        s = line.strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return "\n".join(out)


def _strip_nul_chars(text: str) -> str:
    return (text or "").replace("\x00", "")


def _is_likely_noise_line(line: str) -> bool:
    t = (line or "").strip().lower()
    if not t:
        return True
    if len(t) <= 1:
        return True
    if any(marker in t for marker in _NOISE_TEXT_MARKERS):
        return True
    return False


def _longest_main_like_text(soup: BeautifulSoup) -> str:
    best = ""
    for sel in _MAIN_CONTENT_SELECTORS:
        try:
            el = soup.select_one(sel)
        except Exception:
            continue
        if not el:
            continue
        chunk = _normalize_visible_lines(el.get_text(separator="\n", strip=True))
        if len(chunk) > len(best):
            best = chunk
    return best


def _extract_candidate_root(soup: BeautifulSoup) -> Tag | BeautifulSoup:
    best_node: Tag | BeautifulSoup = soup
    best_len = 0
    for sel in _MAIN_CONTENT_SELECTORS:
        try:
            node = soup.select_one(sel)
        except Exception:
            continue
        if not node:
            continue
        chunk = _normalize_visible_lines(node.get_text(separator="\n", strip=True))
        if len(chunk) > best_len:
            best_len = len(chunk)
            best_node = node
    return best_node


def _extract_semantic_text(root: Tag | BeautifulSoup) -> str:
    lines: list[str] = []
    for el in root.find_all(_CONTENT_TAGS):
        txt = el.get_text(" ", strip=True)
        txt = re.sub(r"\s+", " ", txt).strip()
        if _is_likely_noise_line(txt):
            continue
        if len(txt) < 6:
            continue
        lines.append(txt)
        if len(lines) >= 2000:
            break
    return _dedupe_lines("\n".join(lines))


def _extract_structured_blocks_from_html(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """从 HTML 提取轻量结构块，供预览分块渲染与目录锚点。"""
    blocks: list[dict[str, Any]] = []
    idx = 0
    for el in soup.find_all(["h1", "h2", "h3", "p", "li", "table", "img"]):
        txt = ""
        t = el.name.lower()
        if t == "img":
            src = (el.get("src") or "").strip()
            if not src:
                continue
            txt = f"![{(el.get('alt') or '').strip()}]({src})"
        elif t == "table":
            rows = []
            for tr in el.find_all("tr"):
                cols = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
                if cols:
                    rows.append("| " + " | ".join(cols) + " |")
            if not rows:
                continue
            if len(rows) >= 1 and not re.search(r"\|\s*-+\s*\|", rows[1] if len(rows) > 1 else ""):
                sep = "| " + " | ".join(["---"] * max(1, rows[0].count("|") - 1)) + " |"
                rows = [rows[0], sep, *rows[1:]]
            txt = "\n".join(rows)
        else:
            txt = el.get_text(" ", strip=True)
        txt = (txt or "").strip()
        if not txt:
            continue
        idx += 1
        block: dict[str, Any] = {"id": f"html-{idx}", "type": t, "text": txt}
        if t in ("h1", "h2", "h3"):
            block["level"] = int(t[1])
        blocks.append(block)
        if len(blocks) >= 800:
            break
    return blocks


def _detect_page_kind(url: str, soup: BeautifulSoup, content_hint: str) -> str:
    path = (urlparse(url).path or "").lower()
    if any(x in path for x in ("/docs/", "/doc/", "/wiki/", "/reference/")):
        return "doc"
    if any(x in path for x in ("/article/", "/post/", "/news/", "/blog/", "/explore/")):
        return "article"
    lines = [x.strip() for x in (content_hint or "").split("\n") if x.strip()]
    heading_count = len(soup.find_all(["h1", "h2", "h3"]))
    link_count = len(soup.find_all("a"))
    if heading_count >= 6 and any("```" in ln for ln in lines):
        return "doc"
    if link_count >= 40 and len(lines) <= 30:
        return "list"
    if len(lines) >= 8:
        return "article"
    return "generic"


def _score_content_quality(text: str, *, page_kind: str) -> tuple[float, dict[str, Any]]:
    lines = [x.strip() for x in (text or "").split("\n") if x.strip()]
    total = len(lines)
    if total == 0:
        return 0.0, {"lines": 0, "noise_ratio": 1.0, "avg_line_len": 0}
    noise = sum(1 for ln in lines if _is_likely_noise_line(ln))
    avg_len = sum(len(ln) for ln in lines) / total
    density = min(1.0, len(text) / 4000.0)
    struct_bonus = 0.08 if any(ln.startswith("#") for ln in lines[:40]) else 0.0
    if page_kind == "doc":
        struct_bonus += 0.06
    if page_kind == "list":
        struct_bonus -= 0.08
    score = max(0.0, min(1.0, 0.45 * density + 0.35 * (1 - noise / total) + 0.2 * min(1.0, avg_len / 80.0) + struct_bonus))
    return score, {"lines": total, "noise_ratio": round(noise / total, 3), "avg_line_len": int(avg_len)}


def _extract_links_for_list_page(soup: BeautifulSoup, url: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for a in soup.find_all("a"):
        href = str(a.get("href") or "").strip()
        text = re.sub(r"\s+", " ", a.get_text(" ", strip=True) or "").strip()
        if not href or not text:
            continue
        # 仅保留 http(s) 链接或站内绝对路径，跳过锚点/javascript
        if href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        if href.startswith("/"):
            p = urlparse(url)
            if p.scheme and p.netloc:
                href = f"{p.scheme}://{p.netloc}{href}"
        if not href.startswith("http://") and not href.startswith("https://"):
            continue
        key = f"{href.lower()}|{text.lower()}"
        if key in seen:
            continue
        seen.add(key)
        items.append({"title": text[:180], "url": href[:1000]})
        if len(items) >= 60:
            break
    return items


def _extract_meta_content(soup: BeautifulSoup) -> str:
    """提取页面 meta/JSON-LD 中的文本作为动态站点兜底正文。"""
    parts: list[str] = []
    seen: set[str] = set()

    def push(raw: str | None) -> None:
        txt = (raw or "").strip()
        if not txt:
            return
        txt = re.sub(r"\s+", " ", txt).strip()
        if len(txt) < 8:
            return
        key = txt.lower()
        if key in seen:
            return
        seen.add(key)
        parts.append(txt)

    # 常见 SEO 文本
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    push(title)
    for selector in (
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[property="og:site_name"]',
    ):
        el = soup.select_one(selector)
        if not el:
            continue
        push(el.get("content"))

    # JSON-LD 里可能有 articleBody/description/headline（部分站点含正文摘要）
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = (script.string or script.get_text() or "").strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            if not isinstance(row, dict):
                continue
            push(str(row.get("headline") or ""))
            push(str(row.get("name") or ""))
            push(str(row.get("description") or ""))
            push(str(row.get("articleBody") or ""))

    return "\n".join(parts).strip()


def _extract_page_title(soup: BeautifulSoup) -> str:
    for selector in (
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        "title",
    ):
        if selector == "title":
            txt = soup.title.get_text(" ", strip=True) if soup.title else ""
        else:
            el = soup.select_one(selector)
            txt = str((el.get("content") if el else "") or "").strip()
        txt = re.sub(r"\s+", " ", txt).strip()
        if len(txt) >= 2:
            return txt
    return ""


def _json_unescape_maybe(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    try:
        # 利用 JSON 字符串解码规则，处理 \n、\uXXXX、转义引号等。
        return ihtml.unescape(json.loads(f'"{s}"'))
    except Exception:
        return ihtml.unescape(s)


def _extract_xiaohongshu_note_parts(html: str, note_id: str = "") -> tuple[str, str]:
    """
    小红书网页正文常在 window.__INITIAL_STATE__.note.noteDetailMap.*.note.desc 中，
    DOM 可见文本不稳定时优先使用该数据。
    """
    body = html or ""
    if not body:
        return "", ""
    scope = body
    nid = (note_id or "").strip()
    # 先按 note_id 缩小范围，优先抓目标笔记，避免误命中站点其他脚本字段。
    if nid:
        p = body.find(f'"{nid}"')
        if p >= 0:
            scope = body[p:p + 220000]
    # 从脚本态里抓取 note.title / note.desc，desc 往往是完整正文。
    desc_candidates = re.findall(r'"desc"\s*:\s*"((?:\\.|[^"\\])*)"', scope, flags=re.S)
    title_candidates = re.findall(r'"title"\s*:\s*"((?:\\.|[^"\\])*)"', scope, flags=re.S)
    desc = ""
    if desc_candidates:
        desc = max((_json_unescape_maybe(x) for x in desc_candidates), key=lambda x: len(x or ""))
    title = ""
    if title_candidates:
        title = max((_json_unescape_maybe(x) for x in title_candidates), key=lambda x: len(x or ""))
    # 清理常见站点噪音标题（如备案信息）。
    if "小红书_沪ICP备" in title or title.strip() == "小红书":
        title = ""
    return title.strip(), re.sub(r"\n{3,}", "\n\n", desc).strip()


def _normalized_host(url: str) -> str:
    try:
        netloc = (urlparse(url).netloc or "").strip().lower()
    except Exception:
        return ""
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return re.sub(r":\d+$", "", netloc)


def _note_id_from_xiaohongshu_url(url: str) -> str:
    try:
        path = (urlparse(url).path or "").strip()
    except Exception:
        return ""
    m = re.search(r"/explore/([a-zA-Z0-9]+)", path)
    return (m.group(1) if m else "").strip()


def _looks_like_xiaohongshu_shell_text(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    low = t.lower()
    markers = (
        "沪icp备",
        "营业执照",
        "沪公网安备",
        "增值电信业务经营许可证",
        "互联网药品信息服务资格证书",
        "行吟信息科技（上海）有限公司",
        "地址：上海市黄浦区马当路",
        "发现\n直播\n发布\n通知",
    )
    hit = sum(1 for m in markers if m in t or m in low)
    # 命中多个备案/壳层关键词，且几乎没有正文段落特征时，判定为壳文本。
    has_dialog_like = ("“" in t and "”" in t) or ("。" in t and len(t) >= 120)
    return hit >= 2 and not has_dialog_like


def _looks_like_bot_verification_page(*, host: str, title: str, content: str) -> bool:
    h = (host or "").lower().strip()
    t = (title or "").strip().lower()
    c = (content or "").strip().lower()
    sample = f"{t}\n{c}"[:1200]
    markers = (
        "安全验证",
        "百度安全验证",
        "网络不给力，请稍后重试",
        "请完成验证",
        "行为验证",
        "人机验证",
        "访问过于频繁",
        "稍后重试",
    )
    hit = sum(1 for m in markers if m.lower() in sample)
    if ("baidu.com" in h or "baijiahao.baidu.com" in h) and hit >= 1:
        return True
    return hit >= 2


def _referer_for_url(url: str) -> str:
    try:
        p = urlparse(url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}/"
    except Exception:
        pass
    return "https://www.google.com/"


def _is_private_or_local_host(host: str) -> bool:
    h = (host or "").strip().lower()
    if not h:
        return True
    if h in ("localhost",):
        return True
    if h.endswith(".local") or h.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved)
    except ValueError:
        return False


def _validate_url_safety(url: str) -> tuple[bool, str, str]:
    try:
        p = urlparse(url)
    except Exception:
        return False, "invalid_url", "无效 URL"
    scheme = (p.scheme or "").lower()
    if scheme not in ("http", "https"):
        return False, "invalid_url", "仅支持 http/https 链接"
    host = (p.hostname or "").strip().lower()
    if not host:
        return False, "invalid_url", "URL 缺少主机名"
    if _is_private_or_local_host(host):
        return False, "unsafe_url", "为安全起见，不支持内网或本机地址"
    return True, "", ""


def _is_js_shell_html(html: str, text_content: str) -> bool:
    body = (html or "").lower()
    text = (text_content or "").strip().lower()
    if not body:
        return False
    script_cnt = len(re.findall(r"<script\b", body))
    shell_markers = ("__next", "__nuxt", "id=\"app\"", "webpack", "hydration", "root")
    has_shell_marker = any(m in body for m in shell_markers)
    has_too_little_text = len(text) < 120
    return script_cnt >= 12 and has_shell_marker and has_too_little_text


def _js_render_enabled() -> bool:
    return (os.getenv("URL_PARSER_ENABLE_JS_RENDER", "1") or "").strip().lower() not in ("0", "false", "no")


def _should_try_js_render(*, best_score: float, html: str, content: str, host: str) -> bool:
    if not _js_render_enabled():
        return False
    # 小红书已有专用路径，避免多余浏览器开销。
    if host.endswith("xiaohongshu.com"):
        return False
    if best_score < 0.22 and len((content or "").strip()) < 220:
        return True
    return _is_js_shell_html(html, content)


def _fetch_rendered_html_with_playwright(url: str, timeout_sec: int) -> tuple[str, str]:
    """
    返回 (html, detail)。detail 用于日志排查。
    依赖未安装或浏览器不可用时抛出异常，由上层降级。
    """
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"playwright_unavailable:{exc}") from exc

    timeout_ms = max(3000, min(120000, int(timeout_sec * 1000)))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
            )
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            # 轻量滚动与短等待，覆盖懒加载与客户端渲染首屏。
            page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.6)")
            page.wait_for_timeout(500)
            # 尝试点击常见“展开全文”按钮。
            for sel in ("text=展开全文", "text=Read more", "button:has-text('展开')"):
                try:
                    locator = page.locator(sel).first
                    if locator.count() > 0:
                        locator.click(timeout=1200)
                        page.wait_for_timeout(300)
                        break
                except Exception:
                    continue
            html = page.content() or ""
            return html, "playwright:domcontentloaded+scroll"
        finally:
            try:
                context.close()
            except Exception:
                pass
            browser.close()


class ContentParser:
    """内容解析器"""

    def parse_url(self, url: str) -> Dict[str, Any]:
        """
        解析网页内容

        Args:
            url: 网页 URL

        Returns:
            包含解析文本和日志的字典
        """
        logs = []
        logs.append(f"开始解析网址: {url}")
        host = _normalized_host(url)
        safe, safe_code, safe_msg = _validate_url_safety(url)
        if not safe:
            hint = actionable_hint_for_failed_url(url, error_code=safe_code, upstream_error=safe_msg)
            logs.append(f"错误: {safe_msg}")
            return {
                "success": False,
                "error": safe_msg,
                "hint": hint,
                "logs": logs,
                "source": "url",
                "error_code": safe_code,
            }

        try:
            # 发送 HTTP 请求，使用更真实的浏览器请求头；Referer 与目标站同源，减少部分站点误拦
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-User": "?1",
                "Cache-Control": "max-age=0",
                "Referer": _referer_for_url(url),
                "DNT": "1",
            }

            session = requests.Session()
            session.headers.update(headers)

            response = session.get(url, timeout=TIMEOUTS["url_parsing"], allow_redirects=True)
            response.raise_for_status()
            raw_html = _clean_extracted_text(_decode_html_response(response))

            logs.append(f"成功获取网页内容，状态码: {response.status_code}")

            soup = BeautifulSoup(raw_html, "html.parser")
            meta_text = _extract_meta_content(soup)
            page_title = _extract_page_title(soup)
            page_kind = "generic"

            soup_base = BeautifulSoup(raw_html, "html.parser")
            _strip_script_style(soup_base)
            _strip_chrome_layout(soup_base)
            _strip_noise_by_attr(soup_base)
            full_text = _dedupe_lines(_normalize_visible_lines(soup_base.get_text(separator="\n", strip=True)))
            page_kind = _detect_page_kind(url, soup_base, full_text)

            candidate_root = _extract_candidate_root(soup_base)
            main_like = _dedupe_lines(
                _normalize_visible_lines(candidate_root.get_text(separator="\n", strip=True))
            )
            semantic_text = _extract_semantic_text(candidate_root)
            merged_content_first = _dedupe_lines("\n".join(x for x in (semantic_text, main_like) if x.strip()))

            candidates: list[tuple[str, str]] = [
                ("semantic_main", merged_content_first),
                ("main_selector", main_like),
                ("full_page", full_text),
            ]
            if meta_text:
                candidates.append(("meta_jsonld", _dedupe_lines(meta_text)))
            best_name = "full_page"
            best_content = ""
            best_score = -1.0
            best_quality: dict[str, Any] = {}
            for name, txt in candidates:
                score, quality = _score_content_quality(txt, page_kind=page_kind)
                if score > best_score:
                    best_name = name
                    best_content = txt
                    best_score = score
                    best_quality = quality
            content = best_content
            logs.append(f"网页类型识别: {page_kind}")
            logs.append(f"抽取策略: {best_name}（score={best_score:.2f}）")
            if _should_try_js_render(
                best_score=best_score,
                html=raw_html,
                content=content,
                host=host,
            ):
                try:
                    rendered_html, rendered_detail = _fetch_rendered_html_with_playwright(url, TIMEOUTS["url_parsing"])
                    rendered_soup = BeautifulSoup(rendered_html, "html.parser")
                    _strip_script_style(rendered_soup)
                    _strip_chrome_layout(rendered_soup)
                    _strip_noise_by_attr(rendered_soup)
                    rendered_root = _extract_candidate_root(rendered_soup)
                    rendered_semantic = _extract_semantic_text(rendered_root)
                    rendered_full = _dedupe_lines(
                        _normalize_visible_lines(rendered_soup.get_text(separator="\n", strip=True))
                    )
                    rendered_content = _dedupe_lines(
                        "\n".join(x for x in (rendered_semantic, rendered_full) if x.strip())
                    )
                    rendered_score, rendered_quality = _score_content_quality(rendered_content, page_kind=page_kind)
                    if rendered_score > best_score and len(rendered_content.strip()) >= max(120, len(content.strip())):
                        content = rendered_content
                        best_score = rendered_score
                        best_name = "js_rendered_semantic"
                        best_quality = rendered_quality
                        candidate_root = rendered_root
                        soup_base = rendered_soup
                        logs.append(f"触发 JS 渲染回退成功：{rendered_detail}（score={best_score:.2f}）")
                    else:
                        logs.append(
                            f"触发 JS 渲染回退但未优于现有结果（old={best_score:.2f}, new={rendered_score:.2f}）"
                        )
                except Exception as exc:
                    logs.append(f"JS 渲染回退不可用，已降级 HTTP 解析：{str(exc)[:180]}")
            list_links: list[dict[str, str]] = []
            if page_kind == "list":
                list_links = _extract_links_for_list_page(soup_base, url)
                if list_links:
                    link_lines = [f"- {x['title']}: {x['url']}" for x in list_links[:40]]
                    content = "【列表页链接索引】\n" + "\n".join(link_lines)
                    best_name = "list_links_index"
                    best_score = max(best_score, 0.35)
                    best_quality = {
                        "lines": len(link_lines),
                        "noise_ratio": 0.0,
                        "avg_line_len": int(sum(len(x) for x in link_lines) / max(1, len(link_lines))),
                    }
                    logs.append(f"列表页策略：提取候选链接 {len(list_links)} 条")
            xhs_script_extract_hit = False
            if host.endswith("xiaohongshu.com"):
                xhs_title, xhs_desc = _extract_xiaohongshu_note_parts(raw_html, _note_id_from_xiaohongshu_url(url))
                if xhs_title:
                    page_title = _strip_nul_chars(xhs_title)
                # 小红书正文优先使用脚本态 desc（可见 DOM 常常只有壳层文本）。
                if len((xhs_desc or "").strip()) >= 40:
                    content = _strip_nul_chars(xhs_desc)
                    xhs_script_extract_hit = True
                    logs.append("使用小红书脚本态正文抽取")
                elif _looks_like_xiaohongshu_shell_text(content):
                    hint = actionable_hint_for_failed_url(
                        url,
                        error_code="login_wall",
                        upstream_error="xiaohongshu_shell_text_only",
                    )
                    logs.append("小红书仅获取到页面壳层文本，未命中正文")
                    return {
                        "success": False,
                        "error": "小红书页面仅获取到导航/备案等壳层文本，未解析到正文",
                        "hint": hint,
                        "logs": logs,
                        "source": "url",
                        "error_code": "login_wall",
                    }
            # 动态站点常无可见正文，且低置信度时回退到 meta/JSON-LD。
            if (best_score < 0.28 or len((content or "").strip()) < 80) and len(meta_text) >= 40:
                content = f"{content}\n\n{meta_text}".strip() if content else meta_text
                logs.append("触发低置信度回退：meta/JSON-LD")
                logs.append("使用 meta/JSON-LD 兜底抽取")
            content = _clean_extracted_text(content)
            page_title = _clean_extracted_text(page_title)
            if _looks_like_bot_verification_page(host=host, title=page_title, content=content):
                hint = actionable_hint_for_failed_url(
                    url,
                    error_code="login_wall",
                    upstream_error="bot_verification_page",
                )
                logs.append("命中站点安全验证页，正文不可用")
                return {
                    "success": False,
                    "error": "目标站点返回安全验证页，未提供可解析正文",
                    "hint": hint,
                    "logs": logs,
                    "source": "url",
                    "error_code": "login_wall",
                }
            structured_blocks = _extract_structured_blocks_from_html(
                BeautifulSoup(str(candidate_root), "html.parser")
            )
            for block in structured_blocks:
                if isinstance(block.get("text"), str):
                    block["text"] = _clean_extracted_text(str(block.get("text") or ""))

            if not (content or "").strip():
                hint = actionable_hint_for_failed_url(url, error_code=None, upstream_error="empty_body")
                logs.append("抽取结果为空")
                return {
                    "success": False,
                    "error": "页面中未解析出可见正文",
                    "hint": hint,
                    "logs": logs,
                    "source": "url",
                    "error_code": "empty_body",
                }

            logs.append(f"成功提取文本，共 {len(content)} 字符")

            return {
                "success": True,
                "content": content,
                "title": page_title,
                "structured_blocks": structured_blocks,
                "parse_meta": {
                    "page_kind": page_kind,
                    "strategy": best_name,
                    "quality_score": round(best_score, 3),
                    "quality": best_quality,
                    "js_render_fallback": best_name == "js_rendered_semantic",
                    "list_links_count": len(list_links) if page_kind == "list" else 0,
                    "xhs_script_extract_hit": xhs_script_extract_hit,
                },
                "logs": logs,
                "source": "url",
                "url": url,
            }

        except requests.Timeout:
            error_msg = f"网页解析超时（{TIMEOUTS['url_parsing']}秒）"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            hint = actionable_hint_for_failed_url(url, error_code="timeout", upstream_error=error_msg)
            return {
                "success": False,
                "error": error_msg,
                "hint": hint,
                "logs": logs,
                "source": "url",
                "error_code": "timeout",
            }

        except requests.RequestException as e:
            err_s = str(e)
            if "403" in err_s or "Forbidden" in err_s:
                error_msg = "该网站拒绝了访问请求（403 Forbidden），常见原因为反爬或需登录。"
                logs.append(f"访问被拒绝: {url}")
                logger.warning("403 Forbidden: %s", url)
                code = "403"
            else:
                error_msg = f"网页请求失败: {err_s}"
                logs.append(f"错误: {error_msg}")
                logger.error(error_msg)
                code = "403" if "403" in err_s else "network_error"

            hint = actionable_hint_for_failed_url(url, error_code=code, upstream_error=err_s)
            return {
                "success": False,
                "error": error_msg,
                "hint": hint,
                "logs": logs,
                "source": "url",
                "error_code": code,
            }

        except Exception as e:
            error_msg = f"网页解析失败: {str(e)}"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            hint = actionable_hint_for_failed_url(url, error_code=None, upstream_error=str(e))
            return {
                "success": False,
                "error": error_msg,
                "hint": hint,
                "logs": logs,
                "source": "url",
            }

    def parse_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        解析 PDF 文件（与笔记上传共用：PyMuPDF + PyPDF2 回退，见 note_document_extract）。
        """
        from app.note_document_extract import extract_pdf_dict_for_legacy

        logs = [f"开始解析 PDF: {pdf_path}"]
        try:
            out = extract_pdf_dict_for_legacy(pdf_path)
            if out.get("success"):
                content = str(out.get("content") or "")
                logs.append(f"成功提取文本，共 {len(content)} 字符")
                return {**out, "logs": logs}
            err = str(out.get("error") or "unknown")
            logs.append(f"错误: {err}")
            return {**out, "logs": logs}
        except Exception as e:
            error_msg = f"PDF 解析失败: {str(e)}"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "logs": logs,
                "source": "pdf",
            }

    def parse_epub(self, epub_path: str) -> Dict[str, Any]:
        """
        解析 EPUB 文件正文（按 spine 顺序提取章节文本）。
        """
        logs = []
        logs.append(f"开始解析 EPUB: {epub_path}")
        try:
            with zipfile.ZipFile(epub_path, "r") as zf:
                # 1) 定位 OPF 路径
                container_xml = zf.read("META-INF/container.xml").decode("utf-8", errors="ignore")
                container_root = ET.fromstring(container_xml)
                rootfile_el = container_root.find(".//{*}rootfile")
                if rootfile_el is None:
                    raise ValueError("EPUB 缺少 rootfile 定义")
                opf_path = (rootfile_el.attrib.get("full-path") or "").strip()
                if not opf_path:
                    raise ValueError("EPUB rootfile 路径为空")

                # 2) 读取 OPF，按 spine 顺序组织 html/xhtml 章节
                opf_xml = zf.read(opf_path).decode("utf-8", errors="ignore")
                opf_root = ET.fromstring(opf_xml)
                manifest = {}
                for item in opf_root.findall(".//{*}manifest/{*}item"):
                    item_id = (item.attrib.get("id") or "").strip()
                    href = (item.attrib.get("href") or "").strip()
                    if item_id and href:
                        manifest[item_id] = href

                spine_ids = []
                for itemref in opf_root.findall(".//{*}spine/{*}itemref"):
                    idref = (itemref.attrib.get("idref") or "").strip()
                    if idref:
                        spine_ids.append(idref)

                opf_dir = opf_path.rsplit("/", 1)[0] if "/" in opf_path else ""
                ordered_files = []
                for item_id in spine_ids:
                    href = manifest.get(item_id)
                    if not href:
                        continue
                    full_path = f"{opf_dir}/{href}" if opf_dir else href
                    full_path = full_path.replace("\\", "/")
                    ordered_files.append(full_path)

                # 兜底：某些 epub spine 不完整，补齐压缩包内 html/xhtml
                if not ordered_files:
                    ordered_files = [
                        name for name in zf.namelist()
                        if name.lower().endswith((".xhtml", ".html", ".htm"))
                    ]

                all_text = []
                for path in ordered_files:
                    try:
                        html = zf.read(path).decode("utf-8", errors="ignore")
                    except KeyError:
                        continue
                    soup = BeautifulSoup(html, "html.parser")
                    for bad in soup(["script", "style"]):
                        bad.decompose()
                    text = soup.get_text(separator="\n", strip=True)
                    text = re.sub(r"\n{2,}", "\n", text).strip()
                    if text:
                        all_text.append(text)

                if not all_text:
                    raise ValueError("EPUB 未提取到可用正文")

                content = "\n\n".join(all_text).strip()
                logs.append(f"成功提取 EPUB 文本，共 {len(content)} 字符")
                return {
                    "success": True,
                    "content": content,
                    "logs": logs,
                    "source": "epub"
                }
        except Exception as e:
            error_msg = f"EPUB 解析失败: {str(e)}"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "logs": logs,
                "source": "epub"
            }

    def merge_contents(self, text_input: str = "", url_content: str = "", pdf_content: str = "") -> str:
        """
        合并多种来源的内容

        Args:
            text_input: 用户输入的文本
            url_content: 网页解析的内容
            pdf_content: PDF 解析的内容

        Returns:
            合并后的文本
        """
        contents = []

        if text_input and text_input.strip():
            contents.append(f"【用户输入】\n{text_input.strip()}")

        if url_content and url_content.strip():
            contents.append(f"【网页内容】\n{url_content.strip()}")

        if pdf_content and pdf_content.strip():
            contents.append(f"【PDF 内容】\n{pdf_content.strip()}")

        if not contents:
            return "没有可用的内容"

        merged = "\n\n==========\n\n".join(contents)
        logger.info(f"成功合并 {len(contents)} 个来源的内容，总长度: {len(merged)}")

        return merged


# 单例实例
content_parser = ContentParser()
