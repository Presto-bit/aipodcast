import { NextRequest, NextResponse } from "next/server";
import {
  buildSessionSetCookieHeader,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../lib/bff";
import { allowLoginPerIp, clientIpFromNextRequest } from "../../../../lib/authRouteRateLimit";

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);
  const key = clientIpFromNextRequest(req);
  if (!allowLoginPerIp(key)) {
    return NextResponse.json(
      { success: false, error: "too_many_login_attempts", detail: "请约 1 分钟后再试" },
      { status: 429, headers: { "x-request-id": requestId } }
    );
  }

  const raw = await req.text();
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/login", {
      method: "POST",
      payload: raw || "{}",
      body: raw || "{}",
      requestId,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
    });
    const text = await upstream.text();
    const headers = new Headers({ "content-type": "application/json", "x-request-id": requestId });
    if (upstream.ok) {
      try {
        const j = JSON.parse(text) as { success?: boolean; token?: string };
        if (j.success && j.token) {
          const c = buildSessionSetCookieHeader(j.token);
          if (c) headers.append("set-cookie", c);
        }
      } catch {
        // ignore invalid JSON
      }
    }
    return new Response(text, { status: upstream.status, headers });
  } catch {
    return NextResponse.json(
      { success: false, error: "upstream_unreachable", detail: "orchestrator request failed" },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }
}
