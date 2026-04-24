/**
 * 编排器 HTTP 根地址（必须含协议，且为绝对 URL）。
 * - **生产**：只用 `ORCHESTRATOR_URL`（Docker 内 `http://orchestrator:8008` 等）；勿把 `NEXT_PUBLIC_ORCHESTRATOR_URL=http://127.0.0.1:8008`
 *   打进公网包——浏览器无法访问用户本机 127，且易与 BFF 内网地址混淆。
 * - **非生产**：允许用 `NEXT_PUBLIC_ORCHESTRATOR_URL` 或缺省时回退 `http://127.0.0.1:8008` 便于本机联调。
 */
function isLoopbackOrchestratorUrl(url: string): boolean {
  const s = String(url || "").trim();
  if (!s) return false;
  try {
    const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
    const u = new URL(withScheme);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return /127\.0\.0\.1|localhost/i.test(s);
  }
}

export function resolveOrchestratorBaseUrl(): string {
  const server = (typeof process !== "undefined" && process.env.ORCHESTRATOR_URL?.trim()) || "";
  const pubRaw = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ORCHESTRATOR_URL?.trim()) || "";
  const pub =
    process.env.NODE_ENV === "production" && pubRaw && isLoopbackOrchestratorUrl(pubRaw) ? "" : pubRaw;

  let raw = server || pub || "";
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      return "";
    }
    raw = "http://127.0.0.1:8008";
  }
  let t = String(raw).trim();
  if (!/^https?:\/\//i.test(t)) {
    t = `http://${t}`;
  }
  return t.replace(/\/+$/, "");
}
