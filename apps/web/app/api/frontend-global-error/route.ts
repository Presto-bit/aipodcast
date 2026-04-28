import { NextRequest, NextResponse } from "next/server";
import { APP_RELEASE } from "../../../core/config";
import { ingestClientLogEvent } from "../../../core/observability";
import { AppErrorCodes, errorJson } from "../../../core/errors";
import { getOrCreateRequestId, incomingAuthHeadersFrom } from "../../../lib/bff";
import { sanitizeClientDiagnosticsValue } from "../../../lib/clientDiagnosticsSanitize";

const MAX_BODY_BYTES = 24_000;

/**
 * 前端全局异常上报（window.onerror / unhandledrejection）。
 * 受日志管理后台 `frontend_global_error` 开关、TTL、采样控制。
 */
export async function POST(req: NextRequest) {
  const auth = incomingAuthHeadersFrom(req);
  if (!auth.authorization) {
    return errorJson(401, AppErrorCodes.Unauthorized, "unauthorized");
  }
  const requestId = getOrCreateRequestId(req);
  const traceId = (req.headers.get("x-trace-id") || req.headers.get("traceparent") || "").slice(0, 120);
  const raw = await req.text();
  if (!raw.trim()) return errorJson(400, AppErrorCodes.EmptyPayload, "empty");
  if (raw.length > MAX_BODY_BYTES) {
    return errorJson(413, AppErrorCodes.PayloadTooLarge, "payload_too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return errorJson(400, AppErrorCodes.InvalidJson, "invalid_json");
  }
  const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const message =
    typeof rec.message === "string" ? rec.message.slice(0, 1200) : "frontend_global_error_message_missing";
  const location = typeof rec.location === "string" ? rec.location.slice(0, 240) : undefined;
  const source = rec.source === "unhandledrejection" ? "unhandledrejection" : "onerror";
  const route = typeof rec.route === "string" ? rec.route.slice(0, 240) : "";
  const release = typeof rec.release === "string" ? rec.release.slice(0, 48) : APP_RELEASE;
  const data = sanitizeClientDiagnosticsValue(rec.data ?? {}, 4, 4000);
  const accepted = await ingestClientLogEvent({
    scope: "frontend_global_error",
    requestId,
    traceId,
    level: "error",
    errorCode: source === "unhandledrejection" ? "FRONTEND_UNHANDLED_REJECTION" : "FRONTEND_WINDOW_ERROR",
    module: "frontend",
    route,
    release,
    message,
    location,
    logger: "error",
    payload: {
      source,
      data
    }
  });
  if (!accepted) return NextResponse.json({ ok: true, requestId, skipped: true });
  return NextResponse.json({ ok: true, requestId });
}
