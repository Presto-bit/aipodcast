"""
笔记附件正文抽取（上传与播客加载共用）。

- PDF：优先 PyMuPDF（fitz），失败或几乎无字时回退 PyPDF2。
- DOCX：优先 python-docx，失败回退 word/document.xml 正则。
- 纯文本：charset-normalizer 探测编码，失败再用 utf-8 ignore。
- HTML/HTM/XHTML：BeautifulSoup 去脚本样式与嵌入媒体后抽取可见文本。
- EPUB：临时文件 + content_parser.parse_epub（避免重复实现 spine 逻辑）。
- DOC：临时文件 + antiword / catdoc / soffice（与旧逻辑一致）。
"""
from __future__ import annotations

import io
import logging
import os
import re
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Any

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
    return data.decode("utf-8", errors="ignore"), None


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
