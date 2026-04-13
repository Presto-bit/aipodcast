/**
 * 编排器 HTTP 根地址（必须含协议，且为绝对 URL）。
 * 若误配为相对路径或未设置，服务端 fetch 会打到 Next 自身，出现 /api/v1/* → 404 Not Found。
 */
export function resolveOrchestratorBaseUrl(): string {
  const raw =
    (typeof process !== "undefined" && (process.env.ORCHESTRATOR_URL || process.env.NEXT_PUBLIC_ORCHESTRATOR_URL)) || "";
  let t = String(raw).trim();
  if (!t) {
    t = "http://127.0.0.1:8008";
  }
  if (!/^https?:\/\//i.test(t)) {
    t = `http://${t}`;
  }
  return t.replace(/\/+$/, "");
}
