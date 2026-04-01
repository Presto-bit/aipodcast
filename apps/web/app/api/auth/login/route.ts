import { NextRequest, NextResponse } from "next/server";
import {
  buildSessionSetCookieHeader,
  fetchOrchestrator,
  incomingAuthHeadersFrom
} from "../../../../lib/bff";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function allowLogin(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= MAX_ATTEMPTS) return false;
  b.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  if (!allowLogin(key)) {
    return NextResponse.json(
      { success: false, error: "too_many_login_attempts", detail: "请约 1 分钟后再试" },
      { status: 429 }
    );
  }

  const raw = await req.text();
  try {
    const upstream = await fetchOrchestrator("/api/v1/auth/login", {
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
