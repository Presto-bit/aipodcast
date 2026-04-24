import { NextRequest, NextResponse } from "next/server";
import { allowWalletMoneyPostPerIp, clientIpFromNextRequest } from "../../../../lib/authRouteRateLimit";
import {
  incomingAuthHeadersFrom,
  ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
  proxyJsonFromOrchestrator
} from "../../../../lib/bff";
import { paymentWriteOriginAllowed } from "../../../../lib/paymentWriteOrigin";

/**
 * 钱包充值：用户从支付宝返回后主动 trade.query 对账（补异步通知未到编排器的情况）。
 */
export async function POST(req: NextRequest) {
  const ip = clientIpFromNextRequest(req);
  if (!allowWalletMoneyPostPerIp(ip)) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!paymentWriteOriginAllowed(req)) {
    return NextResponse.json({ success: false, error: "forbidden_origin" }, { status: 403 });
  }
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/subscription/alipay/wallet/reconcile", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
