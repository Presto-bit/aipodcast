"""
笔记上传 / URL 导入失败时的可执行建议（与错误码解耦，便于前端展示）。
"""

from __future__ import annotations

from typing import Any

from .note_import_catalog import augment_import_url_head
from .source_hints_cn import domestic_cloud_hint_lines

# 错误码 -> 建议动作（短句，面向最终用户）
_HINT_ACTIONS: dict[str, list[str]] = {
    "PARSE_EMPTY": [
        "确认文件非空且扩展名与内容一致；可尝试用记事本另存为 UTF-8 文本后再上传。",
        "若为扫描版 PDF，请先使用 OCR 工具导出为可搜索 PDF 或 Word。",
    ],
    "PARSE_SCANNED_PDF": [
        "当前不支持扫描版 PDF；请用 OCR 或 WPS/Acrobat 导出为可搜索 PDF / Word 再上传。",
    ],
    "PDF_TEXT_EMPTY": [
        "尝试用其他 PDF 阅读器「另存为」或打印为 PDF；若仍失败可导出为 Word/HTML。",
    ],
    "TEXT_DECODE_EMPTY": [
        "将文本文件另存为 UTF-8 编码后再上传。",
    ],
    "HTML_TEXT_EMPTY": [
        "尝试在浏览器中打开该 HTML，另存为 UTF-8；或复制正文粘贴为 .md 笔记。",
    ],
    "DOCX_TEXT_EMPTY": [
        "在 Word 中另存为 .docx 或导出为 PDF 后重试。",
    ],
    "DOC_PARSE_ERROR": [
        "安装 LibreOffice 后重试，或先在本地将 .doc 另存为 .docx / PDF。",
    ],
    "DOC_TOOL_MISSING": [
        "服务器未配置 antiword/catdoc/LibreOffice，请将 .doc 转为 .docx 或 PDF 再上传。",
    ],
    "EPUB_TEXT_EMPTY": [
        "该 EPUB 可能无文本层或结构异常；可换用其他阅读器导出为 HTML/PDF。",
    ],
    "PARSE_ENGINE_ERROR": [
        "稍后重试；若持续失败请换用 PDF、Markdown 或纯文本上传。",
    ],
    "URL_PARSE_FAILED": [
        "检查链接是否可在浏览器匿名打开；需登录的页面请复制正文或导出文件上传。",
    ],
    "URL_PARSE_LOW_QUALITY": [
        "该页多为导航或壳层内容；请复制正文为 .md/.txt，或导出为 PDF/HTML 上传。",
    ],
    "URL_LOGIN_WALL": [
        "使用可匿名访问的分享链接，或登录后在浏览器复制正文再上传。",
    ],
    "garbled_text": [
        "链接返回内容疑似编码异常；请改用本地上传导出的 HTML/PDF。",
    ],
    "CSV_PARSE_ERROR": [
        "检查 CSV 是否为标准逗号/分号分隔；可尝试用 Excel 另存为 UTF-8 CSV。",
    ],
    "XLSX_PARSE_ERROR": [
        "确认表格未加密；可先另存为 CSV 或导出为 PDF 再上传。",
    ],
    "pdf_too_large": [
        "将 PDF 拆分为较小文件本地上传，或使用可搜索 PDF 导出后再试。",
    ],
    "pdf_url_empty": [
        "确认 PDF 未加密且可在浏览器直接下载；若仍失败请本地上传。",
    ],
}

_DEFAULT_ACTIONS = [
    "换用纯文本、Markdown 或可搜索 PDF 重试。",
    "若来自飞书/语雀等国内文档站，优先使用官方导出为 Word/PDF。",
]


def hint_actions_for_code(code: str | None) -> list[str]:
    c = (code or "").strip()
    if not c:
        return list(_DEFAULT_ACTIONS)
    return list(_HINT_ACTIONS.get(c, _DEFAULT_ACTIONS))


def attach_hint_actions_to_upload_result(out: dict[str, Any]) -> dict[str, Any]:
    """为上传 JSON 响应补充 hintActions（就地修改并返回）。"""
    parse = out.get("parse")
    code = ""
    if isinstance(parse, dict):
        code = str(parse.get("errorCode") or "").strip()
    out["hintActions"] = hint_actions_for_code(code or None)
    return out


def format_import_url_http_detail(
    *,
    err_code: str,
    head: str,
    base_hint: str,
    url: str,
) -> str:
    """组装 import_url 的 HTTP detail 字符串（保持为单字符串以兼容现有前端）。"""
    head_augmented = augment_import_url_head(err_code, head.strip())
    lines = [f"[{err_code}] {head_augmented}", "", base_hint.strip()]
    extra = domestic_cloud_hint_lines(url)
    if extra:
        lines.extend(["", "【国内文档站说明】", *extra])
    lines.extend(["", "【建议】", *[f"· {a}" for a in hint_actions_for_code(err_code)]])
    return "\n".join(x for x in lines if x is not None)
