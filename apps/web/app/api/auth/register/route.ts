import { NextRequest, NextResponse } from "next/server";
import {
  ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
  buildSessionSetCookieHeader,
  describeOrchestratorUnreachable,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);
  const raw = await req.text();
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/register", {
      method: "POST",
      payload: raw || "{}",
      body: raw || "{}",
      requestId,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
      timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS
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
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503, headers: { "x-request-id": requestId } }
    );
  }
}
