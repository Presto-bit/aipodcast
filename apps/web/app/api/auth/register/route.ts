import { NextRequest, NextResponse } from "next/server";
import {
  buildSessionSetCookieHeader,
  fetchOrchestrator,
  incomingAuthHeadersFrom
} from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/register", {
      method: "POST",
      payload: raw || "{}",
      body: raw || "{}",
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
    });
    const text = await upstream.text();
    const headers = new Headers({ "content-type": "application/json" });
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
      { status: 503 }
    );
  }
}
