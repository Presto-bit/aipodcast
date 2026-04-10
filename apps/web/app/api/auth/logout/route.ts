import { NextRequest, NextResponse } from "next/server";
import {
  buildSessionClearCookieHeader,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/logout", {
      method: "POST",
      payload: "{}",
      body: "{}",
      requestId,
      headers: {
        "content-type": "application/json",
        ...incomingAuthHeadersFrom(req)
      }
    });
    const text = await upstream.text();
    const headers = new Headers({ "content-type": "application/json", "x-request-id": requestId });
    headers.append("set-cookie", buildSessionClearCookieHeader());
    return new Response(text, { status: upstream.status, headers });
  } catch {
    return NextResponse.json(
      { success: false, error: "upstream_unreachable", detail: "orchestrator request failed" },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }
}
