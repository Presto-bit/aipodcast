/**
 * 用户/模型生成的 Markdown 外链：仅允许安全 scheme，避免 javascript:/data: 等执行向量。
 */

const BLOCKED_SCHEMES = new Set(["javascript", "data", "vbscript"]);

function blockedScheme(protocol: string): boolean {
  const name = protocol.replace(/:$/, "").toLowerCase();
  return BLOCKED_SCHEMES.has(name);
}

/**
 * @returns 可写回 `<a href>` 的安全值；不安全时返回 `undefined`（由组件降级为 span）。
 */
export function sanitizeUserMarkdownHref(href: string | undefined): string | undefined {
  const h = String(href ?? "").trim();
  if (!h) return undefined;
  if (h.startsWith("#cite-")) return h;
  if (h.startsWith("#")) return h;
  if (h.startsWith("t:")) return h;
  if (h.startsWith("/") && !h.startsWith("//")) return h;

  let u: URL;
  try {
    u = new URL(h);
  } catch {
    return undefined;
  }
  if (blockedScheme(u.protocol)) return undefined;
  if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  if (u.protocol === "mailto:") {
    if (h.length > 2048) return undefined;
    return u.toString();
  }
  return undefined;
}
