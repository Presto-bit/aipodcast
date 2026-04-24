import { NextRequest } from "next/server";
import { allowAlipayWebhookPerIp, clientIpFromNextRequest } from "../../../../lib/authRouteRateLimit";
import {
  ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
  buildInternalHeaders,
  describeOrchestratorUnreachable,
  orchestratorUrl
} from "../../../../lib/bff";

/**
 * 支付宝异步通知公网入口：原样转发 x-www-form-urlencoded body 至编排器验签履约。
 * 开放平台 notify_url 须与编排器 ALIPAY_NOTIFY_URL 一致，例如：https://www.prestoai.cn/api/webhooks/alipay
 */
export async function GET() {
  return new Response(
    "Alipay notify URL is OK (HTTPS reachable). Only POST from Alipay servers is used; browser GET is not the payment callback.\n",
    {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    }
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIpFromNextRequest(req);
  if (!allowAlipayWebhookPerIp(ip)) {
    return new Response("fail", {
      status: 429,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "60" }
    });
  }
  const raw = await req.text();
  const ct = req.headers.get("content-type") || "application/x-www-form-urlencoded";
  let upstream: Response;
  try {
    upstream = await fetch(orchestratorUrl("/api/v1/webhooks/alipay"), {
      method: "POST",
      headers: {
        "content-type": ct,
        "x-fym-client-ip": ip,
        ...buildInternalHeaders(raw)
      },
      body: raw,
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(15_000, ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS))
    });
  } catch (e) {
    console.error("[alipay-webhook-bff] orchestrator unreachable:", describeOrchestratorUnreachable(e));
    return new Response("fail", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  const text = await upstream.text();
  if (!upstream.ok && upstream.status >= 500) {
    console.error(
      "[alipay-webhook-bff] orchestrator error status=%s body_prefix=%s",
      upstream.status,
      text.slice(0, 200).replace(/\s+/g, " ")
    );
  }
  if (upstream.status === 401 || upstream.status === 403) {
    console.error(
      "[alipay-webhook-bff] internal signature rejected by orchestrator (check INTERNAL_SIGNING_SECRET matches web and orchestrator)"
    );
  }
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}
