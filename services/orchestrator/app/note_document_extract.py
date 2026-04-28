"""
笔记附件正文抽取（上传与播客加载共用）。

- PDF：优先 PyMuPDF（fitz），失败或几乎无字时回退 PyPDF2。
- DOCX：优先 python-docx，失败回退 word/document.xml 正则。
- 纯文本：charset-normalizer 探测编码，失败再用 utf-8 ignore。
- HTML/HTM/XHTML：BeautifulSoup 去脚本样式与嵌入媒体后抽取可见文本。
- EPUB：临时文件 + content_parser.parse_epub（避免重复实现 spine 逻辑）。
- DOC：临时文件 + antiword / catdoc / soffice（与旧逻辑一致）。
- 图片（png/jpg/jpeg/webp/gif/avif）：优先走可配置的视觉模型 OCR（Qwen VL）；未配置时仅存档。
"""
from __future__ import annotations

import base64
import io
import logging
import os
import re
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Any

from .providers.openai_compat_text import chat_completion_openai_compatible

logger = logging.getLogger(__name__)


@dataclass
class NoteParseResult:
    """单次解析结果，供写入 metadata 与 API 返回。"""

    text: str
    status: str  # ok | empty | error
    engine: str
    detail: str | None = None
    encoding: str | None = None

    @property
    def ok(self) -> bool:
        return bool((self.text or "").strip())


def _docx_xml_fallback(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            xml_data = zf.read("word/document.xml").decode("utf-8", errors="ignore")
        text = re.sub(r"</w:p>", "\n", xml_data)
        text = re.sub(r"<[^>]+>", "", text)
        return re.sub(r"\n{2,}", "\n", text).strip()
    except Exception:
        return ""


def _docx_python_docx(data: bytes) -> str:
    try:
        from docx import Document  # type: ignore

        doc = Document(io.BytesIO(data))
        lines: list[str] = []
        for p in doc.paragraphs:
            t = (p.text or "").strip()
            if t:
                lines.append(t)
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if (c.text or "").strip()]
                if cells:
                    lines.append("\t".join(cells))
        return "\n".join(lines).strip()
    except Exception as exc:
        logger.debug("python-docx parse failed: %s", exc)
        return ""


def _decode_plain_bytes(data: bytes) -> tuple[str, str | None]:
    if not data:
        return "", None
    # 常见带 BOM 文本优先：避免 UTF-16/UTF-32 被误判后出现乱码或空文本。
    bom_codecs: list[tuple[bytes, str]] = [
        (b"\xef\xbb\xbf", "utf-8-sig"),
        (b"\xff\xfe\x00\x00", "utf-32-le"),
        (b"\x00\x00\xfe\xff", "utf-32-be"),
        (b"\xff\xfe", "utf-16-le"),
        (b"\xfe\xff", "utf-16-be"),
    ]
    for bom, enc in bom_codecs:
        if data.startswith(bom):
            try:
                txt = data.decode(enc)
                if txt.strip():
                    return txt, enc
            except Exception:
                break

    # 无 BOM 时按常见编码做一轮严格解码尝试（先 utf-8，再 utf-16，再 gb18030）。
    preferred_codecs = ("utf-8", "utf-16", "utf-16-le", "utf-16-be", "gb18030")
    for enc in preferred_codecs:
        try:
            txt = data.decode(enc)
            if txt.strip():
                return txt, enc
        except Exception:
            continue
    try:
        from charset_normalizer import from_bytes  # type: ignore

        best = from_bytes(data).best()
        if best is not None:
            s = str(best)
            enc = getattr(best, "encoding", None)
            if s.strip():
                return s, enc
    except Exception as exc:
        logger.debug("charset_normalizer failed: %s", exc)
    # 最后兜底：保证不抛错，并尽量保留可见字符。
    return data.decode("utf-8", errors="ignore"), "utf-8-ignore"


def _pdf_pymupdf(data: bytes) -> tuple[str, bool]:
    try:
        import fitz  # type: ignore

        doc = fitz.open(stream=data, filetype="pdf")
        try:
            parts: list[str] = []
            for i in range(len(doc)):
                parts.append(doc[i].get_text() or "")
            text = "\n".join(parts).strip()
            return text, bool(text.strip())
        finally:
            doc.close()
    except Exception as exc:
        logger.debug("pymupdf failed: %s", exc)
        return "", False


def _pdf_pypdf2(data: bytes) -> tuple[str, bool]:
    try:
        from PyPDF2 import PdfReader  # type: ignore

        reader = PdfReader(io.BytesIO(data))
        parts: list[str] = []
        for page in reader.pages:
            try:
                t = page.extract_text() or ""
                if t.strip():
                    parts.append(t)
            except Exception:
                continue
        text = "\n".join(parts).strip()
        return text, bool(text.strip())
    except Exception as exc:
        logger.debug("pypdf2 failed: %s", exc)
        return "", False


def _epub_via_content_parser(path: str) -> tuple[str, bool]:
    try:
        from app.fyv_shared.content_parser import content_parser

        r = content_parser.parse_epub(path)
        if r.get("success"):
            return str(r.get("content") or "").strip(), True
        return "", False
    except Exception as exc:
        logger.warning("epub parse: %s", exc)
        return "", False


def _parse_doc_path(path: str) -> tuple[str, bool]:
    candidates: list[tuple[list[str], str]] = [
        (["antiword", path], "antiword"),
        (["catdoc", path], "catdoc"),
    ]
    for cmd, _name in candidates:
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if proc.returncode == 0:
                txt = (proc.stdout or "").strip()
                if txt:
                    return txt, True
        except Exception:
            continue
    try:
        out_dir = os.path.dirname(path)
        proc = subprocess.run(
            ["soffice", "--headless", "--convert-to", "txt:Text", "--outdir", out_dir, path],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.returncode == 0:
            txt_path = os.path.splitext(path)[0] + ".txt"
            if os.path.exists(txt_path):
                with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
                    txt = f.read().strip()
                try:
                    os.remove(txt_path)
                except OSError:
                    pass
                if txt:
                    return txt, True
    except Exception:
        pass
    return "", False


def _extract_html_from_bytes(data: bytes) -> NoteParseResult:
    """从本地保存的网页（HTML/XHTML）抽取可见正文，与 parse_url 的 DOM 清洗思路对齐。"""
    if not data:
        return NoteParseResult(text="", status="empty", engine="html", detail="空文件")
    try:
        from bs4 import BeautifulSoup
    except Exception as exc:  # pragma: no cover
        logger.warning("BeautifulSoup unavailable: %s", exc)
        return NoteParseResult(
            text="",
            status="error",
            engine="html",
            detail="HTML 解析依赖不可用",
        )
    raw, _enc = _decode_plain_bytes(data)
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    # 嵌入媒体/控件无可靠文本，移除以免污染或误把 URL 当正文
    for tag in soup.find_all(["iframe", "object", "embed", "video", "audio", "svg", "canvas"]):
        tag.decompose()
    text_out = soup.get_text(separator="\n", strip=True)
    lines = [ln.strip() for ln in text_out.split("\n") if ln.strip()]
    content = "\n".join(lines)
    if content.strip():
        return NoteParseResult(text=content.strip(), status="ok", engine="html-bs4", detail=None)
    return NoteParseResult(
        text="",
        status="empty",
        engine="html-bs4",
        detail="HTML 中未解析出可见文本（可能为框架页或需登录内容）",
    )


def _ocr_image_via_openai_compat(data: bytes, ext: str) -> NoteParseResult:
    """
    图片 OCR（可选能力）：
    - 需配置 QWEN_API_KEY + QWEN_BASE_URL
    - 模型默认 QWEN_VL_MODEL=qwen-vl-plus（可覆写）
    """
    key = str(os.getenv("QWEN_API_KEY") or "").strip()
    base = str(os.getenv("QWEN_BASE_URL") or "").strip()
    model = str(os.getenv("QWEN_VL_MODEL") or "qwen-vl-plus").strip()
    if not key or not base:
        return NoteParseResult(
            text="",
            status="empty",
            engine="image-ocr-disabled",
            detail="图片已上传；未配置 OCR（需 QWEN_API_KEY / QWEN_BASE_URL）",
        )

    mime_map = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "avif": "image/avif",
    }
    mime = mime_map.get((ext or "").lower(), "image/png")
    b64 = base64.b64encode(data).decode("ascii")
    image_data_url = f"data:{mime};base64,{b64}"
    prompt = (
        "请对这张图片做 OCR，只输出可读正文，不要解释。"
        "要求：保留段落与换行；忽略装饰元素；若无可读正文返回空字符串。"
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "你是 OCR 助手，只返回识别后的正文。"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        },
    ]
    try:
        txt = chat_completion_openai_compatible(
            messages=messages,  # type: ignore[arg-type]
            api_base=base,
            api_key=key,
            model=model,
            temperature=0.0,
            timeout_sec=120,
        )
    except Exception as exc:
        logger.warning("image ocr failed model=%s: %s", model, exc)
        return NoteParseResult(
            text="",
            status="empty",
            engine="image-ocr-error",
            detail=f"OCR 失败：{exc}",
        )
    text = str(txt or "").strip()
    if text:
        return NoteParseResult(text=text, status="ok", engine=f"qwen-vl:{model}", detail=None)
    return NoteParseResult(
        text="",
        status="empty",
        engine=f"qwen-vl:{model}",
        detail="OCR 未识别到可用正文",
    )


def extract_pdf_from_bytes(data: bytes) -> NoteParseResult:
    text, ok = _pdf_pymupdf(data)
    engine = "pymupdf"
    if not ok or len((text or "").strip()) < 8:
        t2, ok2 = _pdf_pypdf2(data)
        if ok2 and len(t2.strip()) > len((text or "").strip()):
            text = t2
            engine = "pypdf2"
            ok = True
        elif not (text or "").strip() and t2.strip():
            text = t2
            engine = "pypdf2"
            ok = True
    if (text or "").strip():
        return NoteParseResult(text=text.strip(), status="ok", engine=engine, detail=None)
    return NoteParseResult(
        text="",
        status="empty",
        engine=engine,
        detail="无法提取文本（可能为扫描版 PDF 或加密）",
    )


def extract_text_from_bytes(data: bytes, ext: str) -> NoteParseResult:
    """
    从文件字节抽取纯文本（与 parse_note_temp_path / 播客加载共用）。
    """
    e = (ext or "txt").lower().lstrip(".")
    if not data:
        return NoteParseResult(text="", status="empty", engine="none", detail="空文件")

    if e in ("txt", "md", "markdown"):
        text, enc = _decode_plain_bytes(data)
        st = "ok" if text.strip() else "empty"
        return NoteParseResult(
            text=text,
            status=st,
            engine="charset_normalizer" if enc else "utf-8",
            detail=None if st == "ok" else "无可见文本",
            encoding=enc,
        )

    if e == "docx":
        text = _docx_python_docx(data)
        eng = "python-docx"
        if not text.strip():
            text = _docx_xml_fallback(data)
            eng = "docx-xml-fallback"
        if text.strip():
            return NoteParseResult(text=text, status="ok", engine=eng, detail=None)
        return NoteParseResult(text="", status="empty", engine=eng, detail="DOCX 未解析出正文")

    if e == "pdf":
        return extract_pdf_from_bytes(data)

    if e == "epub":
        with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tmp:
            tmp.write(data)
            path = tmp.name
        try:
            text, ok = _epub_via_content_parser(path)
            if ok and text.strip():
                return NoteParseResult(text=text, status="ok", engine="epub", detail=None)
            return NoteParseResult(
                text="",
                status="empty",
                engine="epub",
                detail="EPUB 未提取到正文",
            )
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    if e == "doc":
        with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tmp:
            tmp.write(data)
            path = tmp.name
        try:
            text, ok = _parse_doc_path(path)
            if ok and text.strip():
                return NoteParseResult(text=text, status="ok", engine="antiword|catdoc|soffice", detail=None)
            return NoteParseResult(
                text="",
                status="empty",
                engine="doc-binary",
                detail="未安装 antiword/catdoc/LibreOffice 或无法解析该 DOC",
            )
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    if e in ("html", "htm", "xhtml"):
        return _extract_html_from_bytes(data)

    if e in ("png", "jpg", "jpeg", "webp", "gif", "avif"):
        return _ocr_image_via_openai_compat(data, e)

    # 未知扩展名：按纯文本尝试
    text, enc = _decode_plain_bytes(data)
    st = "ok" if text.strip() else "empty"
    return NoteParseResult(
        text=text,
        status=st,
        engine="text-fallback",
        detail=None,
        encoding=enc,
    )


def extract_pdf_dict_for_legacy(pdf_path: str) -> dict[str, Any]:
    """
    与 content_parser.parse_pdf 返回结构兼容，供旧调用方使用。
    """
    try:
        with open(pdf_path, "rb") as f:
            data = f.read()
    except Exception as e:
        return {
            "success": False,
            "error": str(e)[:500],
            "content": "",
            "logs": [],
            "source": "pdf",
        }
    res = extract_pdf_from_bytes(data)
    logs: list[str] = [f"engine={res.engine}", f"status={res.status}"]
    if res.ok:
        return {
            "success": True,
            "content": res.text,
            "logs": logs,
            "source": "pdf",
        }
    return {
        "success": False,
        "error": res.detail or "pdf_empty",
        "content": "",
        "logs": logs,
        "source": "pdf",
    }
