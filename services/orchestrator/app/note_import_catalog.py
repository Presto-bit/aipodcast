"""
URL / 导入失败时的错误码补充说明（一句话，便于用户理解根因）。
"""

from __future__ import annotations

# err_code -> 简短中文补充（不含重复的技术栈）
URL_IMPORT_EXTRA_SUMMARY: dict[str, str] = {
    "URL_PARSE_FAILED": "常见原因：需登录、反爬、纯脚本壳页面或链接已失效。",
    "empty_body": "页面无可抽取的正文节点（多为登录壳或仅含脚本）。",
    "timeout": "远端响应超时，稍后可重试或改为导出文件上传。",
    "403": "站点拒绝服务端访问，可尝试导出 PDF / Word 本地上传。",
    "network_error": "网络层请求失败，请检查链接是否可达。",
    "login_wall": "内容在登录或权限验证之后，服务端无法代替浏览器会话。",
    "garbled_text": "响应字节疑似未正确解码（压缩/编码异常），建议导出文件上传。",
    "pdf_too_large": "在线 PDF 超过服务端下载上限，请改用本地上传。",
    "PARSE_SCANNED_PDF": "PDF 无可用文字层，当前不支持扫描件直接入库。",
    "pdf_url_empty": "PDF 链接未能解析出文本（可能加密或损坏）。",
    "URL_PARSE_LOW_QUALITY": "抽取结果多为导航、备案或噪音，已阻止写入知识库。",
    "invalid_url": "链接格式或协议不受支持。",
    "unsafe_url": "出于安全策略，不支持内网或本机地址。",
}


def augment_import_url_head(err_code: str, head: str) -> str:
    c = (err_code or "").strip()
    h = (head or "").strip()
    extra = URL_IMPORT_EXTRA_SUMMARY.get(c)
    if not extra:
        return h
    if extra in h or any(x in h for x in ("扫描版", "登录", "权限")):
        return h
    return f"{h}\n{extra}"
