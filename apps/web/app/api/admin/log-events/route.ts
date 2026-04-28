import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPermission } from "../../../../lib/adminRouteAuth";
import { AppErrorCodes, errorJson } from "../../../../core/errors";
import { LOG_SCOPES, LogScope, getLogStorageInfo, listLogEvents, topErrorClusters } from "../../../../lib/logManagement";

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

function parseMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdminPermission(req, "log:view");
  if (!auth.ok) {
    if (auth.status === 403) return errorJson(403, AppErrorCodes.ForbiddenAdminOnly, auth.error);
    return errorJson(401, AppErrorCodes.Unauthorized, auth.error);
  }
  const scope = parseScope(req.nextUrl.searchParams.get("scope"));
  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
  const levelRaw = req.nextUrl.searchParams.get("level");
  const level = levelRaw === "error" || levelRaw === "info" ? levelRaw : undefined;
  const requestId = (req.nextUrl.searchParams.get("requestId") || "").trim();
  const errorCode = (req.nextUrl.searchParams.get("errorCode") || "").trim();
  const fromMs = parseMs(req.nextUrl.searchParams.get("fromMs"));
  const toMs = parseMs(req.nextUrl.searchParams.get("toMs"));
  const events = await listLogEvents(scope, limit, { level, requestId, errorCode, fromMs, toMs });
  const clusters = await topErrorClusters(scope, 24 * 60 * 60 * 1000, 8);
  const storage = getLogStorageInfo();
  return NextResponse.json({
    success: true,
    scope,
    events,
    clusters,
    storage
  });
}
