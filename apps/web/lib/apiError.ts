/** BFF 等业务错误码 → 用户可读说明（避免只显示英文 code） */
const KNOWN_ERROR_CODES: Record<string, string> = {
  upstream_unreachable: "无法连接编排服务或网关在等待上游时超时，请确认编排器已启动、网络正常，或稍后重试。"
};

/** 解析 BFF / FastAPI 常见错误体：`error`、`detail` 字符串或校验错误数组 */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const o = data as Record<string, unknown>;
  if (typeof o.error === "string" && o.error.trim()) {
    const code = o.error.trim();
    return KNOWN_ERROR_CODES[code] ?? code;
  }
  if (typeof o.detail === "string" && o.detail.trim()) return o.detail.trim();
  if (Array.isArray(o.detail) && o.detail.length > 0) {
    const first = o.detail[0];
    if (first && typeof first === "object" && first !== null && "msg" in first) {
      return String((first as { msg: unknown }).msg);
    }
  }
  return fallback;
}
