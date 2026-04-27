"""
网页 URL 拉取失败时的域名策略与可执行中文提示（笔记导入 / 参考链路等共用）。
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# (域名后缀或精确主机后缀, 提示文案) — 按顺序匹配，先命中先返回
_DOMAIN_HINT_RULES: tuple[tuple[str, str], ...] = (
    (
        "xiaohongshu.com",
        "该站笔记多在登录后由浏览器渲染，服务端无法稳定抓取。\n"
        "你可：① 在浏览器中打开笔记，全选复制正文后保存为本地 txt/md 再上传；② 或「另存为」网页后上传 .html 文件。",
    ),
    (
        "xhslink.com",
        "短链跳转至小红书，同样无法在服务端拉取正文。\n"
        "请在小红书 App/网页内打开后复制正文并保存为本地 txt/md 上传，或上传导出的 .html。",
    ),
    (
        "zhihu.com",
        "知乎长回答常需登录或反爬，链接导入可能失败。\n"
        "请复制回答正文保存为本地 txt/md 上传，或导出/打印为 PDF 后上传。",
    ),
    (
        "bilibili.com",
        "B 站视频页正文多为播放器与脚本，服务端无法替代字幕与转写。\n"
        "请复制简介/专栏文字保存为本地 txt/md 上传，或改用支持纯文本的专栏/文档链接。",
    ),
    (
        "weibo.com",
        "微博正文常需登录态，链接抓取不稳定。\n"
        "请复制微博正文保存为本地 txt/md 后上传。",
    ),
    (
        "twitter.com",
        "该站点限制匿名抓取。\n"
        "请复制推文内容保存为本地 txt/md 后上传，或改用可公开访问的网页/文档链接。",
    ),
    (
        "x.com",
        "该站点限制匿名抓取。\n"
        "请复制推文内容保存为本地 txt/md 后上传，或改用可公开访问的网页/文档链接。",
    ),
    (
        "instagram.com",
        "Instagram 页面需登录且限制服务端访问。\n"
        "请复制可见说明文字保存为本地 txt/md 后上传。",
    ),
    (
        "facebook.com",
        "Facebook 页面常需登录，服务端难以拉取正文。\n"
        "请复制可见文字保存为本地 txt/md 后上传。",
    ),
    (
        "linkedin.com",
        "LinkedIn 内容多在登录墙后。\n"
        "请复制正文保存为本地 txt/md 上传，或导出为 PDF 上传。",
    ),
    (
        "notion.so",
        "Notion 公开页若未发布为「公开到网络」或需登录，服务端可能拉取失败。\n"
        "请确认分享为公开链接，或复制内容保存为本地 txt/md 上传 / 导出 PDF。",
    ),
    (
        "feishu.cn",
        "飞书文档常需登录或内网权限。\n"
        "请使用「对外分享」可匿名访问的链接，或复制正文保存为本地 txt/md 后上传。",
    ),
    (
        "larksuite.com",
        "飞书/ Lark 文档常需登录权限。\n"
        "请使用可匿名访问的分享链接，或复制正文保存为本地 txt/md 后上传。",
    ),
)


def _normalized_host(url: str) -> str:
    try:
        netloc = (urlparse(url).netloc or "").strip().lower()
    except Exception:
        return ""
    if netloc.startswith("www."):
        netloc = netloc[4:]
    # 去掉常见端口
    netloc = re.sub(r":\d+$", "", netloc)
    return netloc


def actionable_hint_for_failed_url(
    url: str,
    *,
    error_code: str | None = None,
    upstream_error: str | None = None,
) -> str:
    """在 parse_url 失败或正文为空时，生成一段用户可立即执行的中文说明。"""
    host = _normalized_host(url)
    for suffix, hint in _DOMAIN_HINT_RULES:
        if host == suffix or host.endswith("." + suffix):
            return hint

    err = (upstream_error or "").lower()
    if error_code == "403" or "403" in err or "forbidden" in err:
        return (
            "站点拒绝了服务端访问（常见于反爬）。\n"
            "你可：① 在浏览器打开该页，复制正文并保存为本地 txt/md 上传；② 或另存为 .html / 打印为 PDF 后本地上传。"
        )
    if "timeout" in err or "timed out" in err or error_code == "timeout":
        return "请求超时。请稍后重试该链接，或改用复制正文 / 本地上传。"

    return (
        "该链接可能为登录后可见、前端渲染或反爬页面，服务端无法可靠抽取正文。\n"
        "建议：① 浏览器中打开页面，复制正文并保存为本地 txt/md 上传；② 或上传 .html / .pdf 等本地文件。"
    )
