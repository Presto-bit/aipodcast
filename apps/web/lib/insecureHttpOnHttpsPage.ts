/**
 * 在 HTTPS 安全上下文中，绝对 `http:` 外链不可安全用于 `<audio src>` / `<img src>` 等，
 * 浏览器会按混合内容策略拦截或升级失败。
 * 典型误配：对象存储预签名仍为内网 `http://minio:9000/...`。
 */
export function unusableInsecureHttpOnHttpsPage(url: string): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  try {
    return new URL(url, window.location.href).protocol === "http:";
  } catch {
    return false;
  }
}
