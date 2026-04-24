import { NextRequest, NextResponse } from "next/server";
import { allowWalletMoneyPostPerIp, clientIpFromNextRequest } from "../../../../lib/authRouteRateLimit";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";
import { paymentWriteOriginAllowed } from "../../../../lib/paymentWriteOrigin";

/**
 * 与 /api/subscription/alipay-page/wallet 等价：显式「充值」入口别名，便于前端与其它系统对齐。
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
  return proxyJsonFromOrchestrator("/api/v1/subscription/alipay/page/wallet", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
