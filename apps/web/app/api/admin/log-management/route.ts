import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "../../../../lib/adminRouteAuth";
import {
  LOG_SCOPES,
  LogScope,
  getLogSwitchConfig,
  listLogSwitchAudits,
  updateLogSwitchConfig
} from "../../../../lib/logManagement";

const TTL_MINUTES_MAX = 24 * 60;
const DEFAULT_SCOPE: LogScope = "notebook_share_client";

function parseScope(raw: string | null): LogScope {
  const normalized = String(raw || "").trim();
  if (LOG_SCOPES.includes(normalized as LogScope)) return normalized as LogScope;
  return DEFAULT_SCOPE;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const scope = parseScope(req.nextUrl.searchParams.get("scope"));
  const config = getLogSwitchConfig(scope);
  const audits = listLogSwitchAudits(scope).slice(0, 50);
  return NextResponse.json({
    success: true,
    scope,
    scopes: LOG_SCOPES,
    config,
    audits
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    enabled?: unknown;
    scope?: unknown;
    ttlMinutes?: unknown;
    minLevel?: unknown;
    sampleRate?: unknown;
    reason?: unknown;
  };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ success: false, error: "enabled_must_be_boolean" }, { status: 400 });
  }
  const ttlRaw = typeof body.ttlMinutes === "number" && Number.isFinite(body.ttlMinutes) ? body.ttlMinutes : 0;
  const ttlMinutes = Math.floor(ttlRaw);
  if (ttlMinutes < 0 || ttlMinutes > TTL_MINUTES_MAX) {
    return NextResponse.json(
      { success: false, error: `ttl_minutes_out_of_range_0_${TTL_MINUTES_MAX}` },
      { status: 400 }
    );
  }
  const scope = parseScope(typeof body.scope === "string" ? body.scope : null);
  const minLevel = body.minLevel === "debug" ? "debug" : "info";
  const sampleRate = typeof body.sampleRate === "number" ? body.sampleRate : 1;
  const reason = typeof body.reason === "string" ? body.reason : "";
  const config = updateLogSwitchConfig({
    scope,
    enabled: body.enabled,
    ttlMinutes: body.enabled ? ttlMinutes || 30 : null,
    minLevel,
    sampleRate,
    reason,
    operator: auth.operator
  });
  return NextResponse.json({
    success: true,
    scope,
    config
  });
}
