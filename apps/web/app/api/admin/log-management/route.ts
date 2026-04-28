import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPermission } from "../../../../lib/adminRouteAuth";
import { LOG_MANAGEMENT_TTL_MAX_MINUTES } from "../../../../core/config";
import { AppErrorCodes, errorJson } from "../../../../core/errors";
import {
  LOG_SCOPES,
  LogScope,
  getLogSwitchConfig,
  listLogSwitchAudits,
  updateLogSwitchConfig
} from "../../../../lib/logManagement";

const DEFAULT_SCOPE: LogScope = "notebook_share_client";

function parseScope(raw: string | null): LogScope {
  const normalized = String(raw || "").trim();
  if (LOG_SCOPES.includes(normalized as LogScope)) return normalized as LogScope;
  return DEFAULT_SCOPE;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdminPermission(req, "log:view");
  if (!auth.ok) {
    if (auth.status === 403) return errorJson(403, AppErrorCodes.ForbiddenAdminOnly, auth.error);
    return errorJson(401, AppErrorCodes.Unauthorized, auth.error);
  }
  const scope = parseScope(req.nextUrl.searchParams.get("scope"));
  const config = await getLogSwitchConfig(scope);
  const audits = (await listLogSwitchAudits(scope)).slice(0, 50);
  return NextResponse.json({
    success: true,
    scope,
    scopes: LOG_SCOPES,
    config,
    audits
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminPermission(req, "log:manage");
  if (!auth.ok) {
    if (auth.status === 403) return errorJson(403, AppErrorCodes.ForbiddenAdminOnly, auth.error);
    return errorJson(401, AppErrorCodes.Unauthorized, auth.error);
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
    return errorJson(400, AppErrorCodes.BadRequest, "enabled_must_be_boolean");
  }
  const ttlRaw = typeof body.ttlMinutes === "number" && Number.isFinite(body.ttlMinutes) ? body.ttlMinutes : 0;
  const ttlMinutes = Math.floor(ttlRaw);
  if (ttlMinutes < 0 || ttlMinutes > LOG_MANAGEMENT_TTL_MAX_MINUTES) {
    return errorJson(
      400,
      AppErrorCodes.BadRequest,
      `ttl_minutes_out_of_range_0_${LOG_MANAGEMENT_TTL_MAX_MINUTES}`,
      { maxTtlMinutes: LOG_MANAGEMENT_TTL_MAX_MINUTES }
    );
  }
  const scope = parseScope(typeof body.scope === "string" ? body.scope : null);
  const minLevel = body.minLevel === "debug" ? "debug" : "info";
  const sampleRate = typeof body.sampleRate === "number" ? body.sampleRate : 1;
  const reason = typeof body.reason === "string" ? body.reason : "";
  const config = await updateLogSwitchConfig({
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
