import { NextRequest, NextResponse } from "next/server";
import { allowWalletMoneyPostPerIp, clientIpFromNextRequest } from "../../../../../lib/authRouteRateLimit";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";
import { paymentWriteOriginAllowed } from "../../../../../lib/paymentWriteOrigin";

export async function POST(req: NextRequest) {
  const ip = clientIpFromNextRequest(req);
  if (!allowWalletMoneyPostPerIp(ip)) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!paymentWriteOriginAllowed(req)) {
    return NextResponse.json({ success: false, error: "forbidden_origin" }, { status: 403 });
  }
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/subscription/wallet-checkout/create", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
