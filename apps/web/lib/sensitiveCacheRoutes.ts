/**
 * 价格 / 权益 / 支付相关：需避免共享 CDN 仅按 URL 缓存导致串数据或旧价；
 * 与 middleware 中的 Cache-Control 配合，对下列路径追加 Vary 等提示头。
 */

/** 浏览器文档路由（非 /api） */
export function sensitiveDocumentPath(pathname: string): boolean {
  if (pathname === "/subscription" || pathname.startsWith("/subscription/")) return true;
  if (pathname === "/me/subscription" || pathname.startsWith("/me/subscription/")) return true;
  return false;
}

/** BFF / 回调等 API */
export function sensitiveApiPath(pathname: string): boolean {
  if (pathname.startsWith("/api/subscription/")) return true;
  if (pathname.startsWith("/api/webhooks/")) return true;
  if (pathname.startsWith("/api/admin/wallet-checkout/")) return true;
  if (pathname === "/api/admin/users/wallet") return true;
  return false;
}
