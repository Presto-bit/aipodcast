import { NextRequest } from "next/server";
import { buildInternalHeaders, orchestratorUrl } from "../../../../lib/bff";

/**
 * 支付宝异步通知公网入口：原样转发 x-www-form-urlencoded body 至编排器验签履约。
 * 开放平台 notify_url 填：https://prestoai.cn/api/webhooks/alipay
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ct = req.headers.get("content-type") || "application/x-www-form-urlencoded";
  const upstream = await fetch(orchestratorUrl("/api/v1/webhooks/alipay"), {
    method: "POST",
    headers: {
      "content-type": ct,
      ...buildInternalHeaders(raw)
    },
    body: raw,
    cache: "no-store"
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}
