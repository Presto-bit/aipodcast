import { NextRequest, NextResponse } from "next/server";
import {
  ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
  describeOrchestratorUnreachable,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../../lib/bff";
import { allowRegisterSendCodePerIp, clientIpFromNextRequest } from "../../../../../lib/authRouteRateLimit";

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);
  const ipKey = clientIpFromNextRequest(req);
  if (!allowRegisterSendCodePerIp(ipKey)) {
    return NextResponse.json(
      { success: false, error: "too_many_register_send_attempts", detail: "发送过于频繁，请约 1 分钟后再试" },
      { status: 429, headers: { "x-request-id": requestId } }
    );
  }

  const raw = await req.text();
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/register/send-code", {
      method: "POST",
      payload: raw || "{}",
      body: raw || "{}",
      requestId,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
      timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "x-request-id": requestId }
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }
}
