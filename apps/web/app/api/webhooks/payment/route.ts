import { NextRequest } from "next/server";
import { proxyJsonFromOrchestrator } from "../../../../lib/bff";

/**
 * BFF：将支付平台 POST 的原始 body 与 X-Payment-Signature 转发至编排器
 * `POST /api/v1/webhooks/payment`（HMAC 验签、幂等与落库在编排器实现）。
 * 生产须配置 PAYMENT_WEBHOOK_SECRET，且勿启用 PAYMENT_WEBHOOK_ALLOW_UNSIGNED。
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-payment-signature") || req.headers.get("X-Payment-Signature") || "";
  return proxyJsonFromOrchestrator("/api/v1/webhooks/payment", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...(sig ? { "X-Payment-Signature": sig } : {})
    }
  });
}
