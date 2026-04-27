"""
内容解析模块
支持网页解析（BeautifulSoup）和 PDF 解析（PyPDF2）
"""

import logging
import requests
import zipfile
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

from bs4 import BeautifulSoup
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


def _normalize_visible_lines(text: str) -> str:
    lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
    return "\n".join(lines)


def _strip_script_style(soup: BeautifulSoup) -> None:
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()


def _strip_chrome_layout(soup: BeautifulSoup) -> None:
    for tag in soup(["nav", "footer", "header"]):
        tag.decompose()


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


def _referer_for_url(url: str) -> str:
    try:
        p = urlparse(url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}/"
    except Exception:
        pass
    return "https://www.google.com/"


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
            response.encoding = response.apparent_encoding or "utf-8"

            logs.append(f"成功获取网页内容，状态码: {response.status_code}")

            soup = BeautifulSoup(response.text, "html.parser")
            _strip_script_style(soup)
            main_like = _longest_main_like_text(soup)

            soup_full = BeautifulSoup(response.text, "html.parser")
            _strip_script_style(soup_full)
            _strip_chrome_layout(soup_full)
            full_text = _normalize_visible_lines(soup_full.get_text(separator="\n", strip=True))

            # 若正文区域明显长于「去壳后全文」的一定比例，优先用正文区（常见博客/新闻）
            if main_like and len(main_like) >= max(200, int(len(full_text) * 0.15)):
                content = main_like
                logs.append("使用正文区选择器抽取（main/article 等）")
            else:
                content = full_text
                logs.append("使用整页去壳文本")
            structured_blocks = _extract_structured_blocks_from_html(soup)

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
                "structured_blocks": structured_blocks,
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
