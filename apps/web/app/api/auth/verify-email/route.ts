import { NextRequest, NextResponse } from "next/server";
import { fetchOrchestrator, getOrCreateRequestId, incomingAuthHeadersFrom } from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);
  const raw = await req.text();
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/verify-email", {
      method: "POST",
      payload: raw || "{}",
      body: raw || "{}",
      requestId,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "x-request-id": requestId }
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "upstream_unreachable", detail: "orchestrator request failed" },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }
}
