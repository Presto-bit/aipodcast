"""
内容解析模块
支持网页解析（BeautifulSoup）和 PDF 解析（PyPDF2）
"""

import logging
import requests
import zipfile
import re
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from PyPDF2 import PdfReader
from typing import Dict, Any
from config import TIMEOUTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
            # 发送 HTTP 请求，使用更真实的浏览器请求头
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'Referer': 'https://www.google.com/',  # 添加 Referer，伪装成从搜索引擎来的
                'DNT': '1'
            }

            # 创建 session 以保持 cookies
            session = requests.Session()
            session.headers.update(headers)

            response = session.get(url, timeout=TIMEOUTS["url_parsing"], allow_redirects=True)
            response.raise_for_status()
            response.encoding = response.apparent_encoding

            logs.append(f"成功获取网页内容，状态码: {response.status_code}")

            # 使用 BeautifulSoup 解析 HTML
            soup = BeautifulSoup(response.text, 'html.parser')

            # 移除 script 和 style 标签
            for script in soup(['script', 'style', 'nav', 'footer', 'header']):
                script.decompose()

            # 提取文本内容
            text = soup.get_text(separator='\n', strip=True)

            # 清理多余的空行
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            content = '\n'.join(lines)

            logs.append(f"成功提取文本，共 {len(content)} 字符")

            return {
                "success": True,
                "content": content,
                "logs": logs,
                "source": "url",
                "url": url
            }

        except requests.Timeout:
            error_msg = f"网页解析超时（{TIMEOUTS['url_parsing']}秒）"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "logs": logs,
                "source": "url"
            }

        except requests.RequestException as e:
            # 检查是否是 403 Forbidden 错误
            if "403" in str(e) or "Forbidden" in str(e):
                error_msg = f"该网站拒绝了访问请求（403 Forbidden）。这通常是因为网站的反爬虫策略限制了服务器访问。\n\n💡 建议：请复制网页文本内容，直接粘贴到「话题文本」输入框中。"
                logs.append(f"访问被拒绝: {url}")
                logger.warning(f"403 Forbidden: {url}")
            else:
                error_msg = f"网页请求失败: {str(e)}"
                logs.append(f"错误: {error_msg}")
                logger.error(error_msg)

            return {
                "success": False,
                "error": error_msg,
                "logs": logs,
                "source": "url",
                "error_code": "403" if "403" in str(e) else "network_error"
            }

        except Exception as e:
            error_msg = f"网页解析失败: {str(e)}"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "logs": logs,
                "source": "url"
            }

    def parse_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        解析 PDF 文件

        Args:
            pdf_path: PDF 文件路径

        Returns:
            包含解析文本和日志的字典
        """
        logs = []
        logs.append(f"开始解析 PDF: {pdf_path}")

        try:
            # 使用 PyPDF2 读取 PDF
            reader = PdfReader(pdf_path)
            num_pages = len(reader.pages)

            logs.append(f"PDF 共 {num_pages} 页")

            # 提取所有页面的文本
            all_text = []
            for i, page in enumerate(reader.pages):
                try:
                    text = page.extract_text()
                    if text.strip():
                        all_text.append(text)
                        logs.append(f"成功提取第 {i + 1} 页内容")
                    else:
                        logs.append(f"警告: 第 {i + 1} 页无法提取文本（可能是扫描版）")
                except Exception as e:
                    logs.append(f"警告: 第 {i + 1} 页提取失败: {str(e)}")

            if not all_text:
                error_msg = "PDF 无法提取文本，可能是扫描版 PDF，不支持此格式"
                logs.append(f"错误: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "logs": logs,
                    "source": "pdf"
                }

            content = '\n'.join(all_text)

            logs.append(f"成功提取文本，共 {len(content)} 字符")

            return {
                "success": True,
                "content": content,
                "logs": logs,
                "source": "pdf",
                "num_pages": num_pages
            }

        except Exception as e:
            error_msg = f"PDF 解析失败: {str(e)}"
            logs.append(f"错误: {error_msg}")
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "logs": logs,
                "source": "pdf"
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
