import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom } from "../../../lib/bff";
import { sanitizeClientDiagnosticsValue } from "../../../lib/clientDiagnosticsSanitize";
import { appendLogEvent, shouldIngestForScope } from "../../../lib/logManagement";

const MAX_BODY_BYTES = 24_000;

/**
 * 前端全局异常上报（window.onerror / unhandledrejection）。
 * 受日志管理后台 `frontend_global_error` 开关、TTL、采样控制。
 */
export async function POST(req: NextRequest) {
  const auth = incomingAuthHeadersFrom(req);
  if (!auth.authorization) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const requestId = getOrCreateRequestId(req);
  const traceId = (req.headers.get("x-trace-id") || req.headers.get("traceparent") || "").slice(0, 120);
  if (!shouldIngestForScope("frontend_global_error", requestId)) {
    return NextResponse.json({ ok: true, requestId, skipped: true });
  }
  const raw = await req.text();
  if (!raw.trim()) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const message =
    typeof rec.message === "string" ? rec.message.slice(0, 1200) : "frontend_global_error_message_missing";
  const location = typeof rec.location === "string" ? rec.location.slice(0, 240) : undefined;
  const source = rec.source === "unhandledrejection" ? "unhandledrejection" : "onerror";
  const route = typeof rec.route === "string" ? rec.route.slice(0, 240) : "";
  const release = typeof rec.release === "string" ? rec.release.slice(0, 48) : "";
  const data = sanitizeClientDiagnosticsValue(rec.data ?? {}, 4, 4000);
  const line = JSON.stringify({
    type: "frontend_global_error",
    ts: new Date().toISOString(),
    requestId,
    traceId,
    errorCode: source === "unhandledrejection" ? "FRONTEND_UNHANDLED_REJECTION" : "FRONTEND_WINDOW_ERROR",
    source,
    route,
    release,
    message,
    location,
    data
  });
  console.error(line);
  appendLogEvent({
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
    payload: {
      source,
      data
    }
  });
  return NextResponse.json({ ok: true, requestId });
}
