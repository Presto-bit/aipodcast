"""
国内常见文档 / 协作站点的导入说明（不做境外产品接入说明）。

仅返回「可执行的中文提示行」，供 URL 导入失败或低质拦截时拼接展示。
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# (主机后缀匹配, 提示行列表)
_CN_DOC_HOST_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "feishu.cn",
        (
            "飞书文档：匿名链接导入常只能抓到登录壳或导航。",
            "优先在飞书内「导出为 Word / PDF」后本地上传；企业场景可对接飞书开放平台用 doc_token 拉取正文（需管理员授权）。",
        ),
    ),
    (
        "yuque.com",
        (
            "语雀：公开网页结构多变，链接导入可能只有目录或摘要。",
            "建议在语雀编辑器中导出 Markdown / PDF / Word 后上传。",
        ),
    ),
    (
        "docs.qq.com",
        (
            "腾讯文档：多数内容在登录态与脚本渲染后，链接导入成功率低。",
            "请使用「导出为本地 Word / PDF」或复制正文到 .md 笔记。",
        ),
    ),
    (
        "doc.weixin.qq.com",
        (
            "企业微信文档：通常需企业成员权限，匿名链接难以解析正文。",
            "请导出文件或复制正文后上传。",
        ),
    ),
    (
        "shimo.im",
        (
            "石墨文档：未公开 API 时建议「导出」为 Word/Markdown/PDF 再上传。",
        ),
    ),
    (
        "dingtalk.com",
        (
            "钉钉文档：与阿里账号体系绑定，服务端抓取受限。",
            "请在钉钉内导出或复制正文后上传。",
        ),
    ),
    (
        "aliyun.com",
        (
            "阿里云知识库 / 帮助文档若含强脚本渲染，链接导入可能不完整。",
            "可尝试导出或打印为 PDF 上传。",
        ),
    ),
    (
        "aliyundrive.com",
        (
            "阿里云盘分享页多为前端渲染与登录态，链接导入难以抽取正文。",
            "请下载文件后在知识库本地上传（表格可用 xls/xlsx/csv，文档可用 pdf/docx）。",
        ),
    ),
    (
        "pan.baidu.com",
        (
            "百度网盘分享链接需在浏览器登录后下载，服务端无法代替提取文件正文。",
            "请先下载到本地，再上传支持的格式（pdf、docx、csv、xlsx 等）。",
        ),
    ),
    (
        "pan.quark.cn",
        (
            "夸克网盘与多数国内网盘类似，匿名链接无法可靠拉取文件内容。",
            "请下载后本地上传。",
        ),
    ),
    (
        "bilibili.com",
        (
            "B 站专栏相对可解析，视频页请以专栏链接或文稿为主。",
        ),
    ),
)


def _host_key(url: str) -> str:
    try:
        h = (urlparse(url).hostname or "").strip().lower()
    except Exception:
        return ""
    if h.startswith("www."):
        h = h[4:]
    return re.sub(r":\d+$", "", h)


def domestic_cloud_hint_lines(url: str) -> list[str]:
    """若 URL 命中国内文档站域名，返回额外说明行；否则空列表。"""
    host = _host_key(url)
    if not host:
        return []
    out: list[str] = []
    for suffix, lines in _CN_DOC_HOST_RULES:
        if host == suffix or host.endswith("." + suffix):
            for ln in lines:
                if ln not in out:
                    out.append(ln)
    return out
