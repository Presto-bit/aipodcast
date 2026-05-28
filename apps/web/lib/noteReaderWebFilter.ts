/** 网页类资料阅读：额外去噪（在 simplifySourceText 之后或并行使用） */

const SKIP_LINE =
  /^(推荐阅读|相关阅读|热门文章|分享到|扫码关注|微信扫一扫|点击关注|免责声明|版权声明|广告|赞助|上一篇|下一篇|返回顶部|收起|展开全文|阅读更多|点赞|在看|转发|收藏|订阅|关注我们)$/i;

const SKIP_PREFIX = /^(来源[:：]|责任编辑[:：]|作者[:：]|发布时间[:：]|阅读[:：]\s*\d)/i;

/**
 * 过滤典型网页侧栏/页脚噪声行（用于 web profile 默认精简链路）。
 */
export function filterWebReadingLines(text: string): string {
  const lines = String(text || "").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^(https?:\/\/|www\.)/i.test(s)) continue;
    if (SKIP_LINE.test(s)) continue;
    if (SKIP_PREFIX.test(s)) continue;
    if (s.length <= 1) continue;
    out.push(raw);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
