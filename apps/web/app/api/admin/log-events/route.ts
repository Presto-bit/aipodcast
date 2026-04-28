import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "../../../../lib/adminRouteAuth";
import { LOG_SCOPES, LogScope, listLogEvents } from "../../../../lib/logManagement";

const DEFAULT_SCOPE: LogScope = "notebook_share_client";

function parseScope(raw: string | null): LogScope {
  const normalized = String(raw || "").trim();
  if (LOG_SCOPES.includes(normalized as LogScope)) return normalized as LogScope;
  return DEFAULT_SCOPE;
}

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(String(raw || "50"), 10);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, n));
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const scope = parseScope(req.nextUrl.searchParams.get("scope"));
  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
  const events = listLogEvents(scope, limit);
  return NextResponse.json({
    success: true,
    scope,
    events
  });
}
