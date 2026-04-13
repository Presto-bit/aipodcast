import { formatOrchestratorErrorText } from "./api";
import { apiErrorMessage } from "./apiError";

/**
 * 解析订阅/支付接口响应文本（兼容 FastAPI detail 字符串与校验数组）。
 */
export function parseSubscriptionErrorBody(text: string, fallback: string): string {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return formatOrchestratorErrorText(text) || fallback;
  }
  return apiErrorMessage(raw, formatOrchestratorErrorText(text) || fallback);
}
