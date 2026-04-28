import { NextRequest, NextResponse } from "next/server";
import { APP_RELEASE, NOTEBOOK_SHARE_SERVER_DIAGNOSTICS_ENABLED } from "../../../core/config";
import { ingestClientLogEvent } from "../../../core/observability";
import { AppErrorCodes, errorJson } from "../../../core/errors";
import { getOrCreateRequestId, incomingAuthHeadersFrom } from "../../../lib/bff";
import { sanitizeClientDiagnosticsValue } from "../../../lib/clientDiagnosticsSanitize";

const MAX_BODY_BYTES = 28_000;

/**
 * 浏览器端笔记本分享诊断上报（生产可检索）。
 * 运维在日志平台检索 JSON 字段 `type":"notebook_share_client"` 或全文 `notebook_share_client`。
 * 关闭：`NOTEBOOK_SHARE_SERVER_DIAGNOSTICS=0`
 */
export async function POST(req: NextRequest) {
  if (!NOTEBOOK_SHARE_SERVER_DIAGNOSTICS_ENABLED) {
    return errorJson(404, AppErrorCodes.Disabled, "disabled");
  }
  const auth = incomingAuthHeadersFrom(req);
  if (!auth.authorization) {
    return errorJson(401, AppErrorCodes.Unauthorized, "unauthorized");
  }
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
  const requestId = getOrCreateRequestId(req);
  const traceId = (req.headers.get("x-trace-id") || req.headers.get("traceparent") || "").slice(0, 120);
  const hypothesisId =
    typeof rec.hypothesisId === "string" ? rec.hypothesisId.slice(0, 48) : undefined;
  const location = typeof rec.location === "string" ? rec.location.slice(0, 240) : undefined;
  const message =
    typeof rec.message === "string" ? rec.message.slice(0, 600) : "notebook_share_client_message_missing";
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId.slice(0, 80) : undefined;
  const timestamp = typeof rec.timestamp === "number" && Number.isFinite(rec.timestamp) ? rec.timestamp : undefined;
  const route = typeof rec.route === "string" ? rec.route.slice(0, 240) : "";
  const release = typeof rec.release === "string" ? rec.release.slice(0, 48) : APP_RELEASE;
  const data = sanitizeClientDiagnosticsValue(rec.data ?? {}, 4, 8000);

  const accepted = await ingestClientLogEvent({
    scope: "notebook_share_client",
    requestId,
    traceId,
    level: "info",
    errorCode: "NOTEBOOK_SHARE_CLIENT_DIAGNOSTIC",
    module: "notebook_share",
    route,
    release,
    message,
    location,
    logger: "log",
    payload: {
      hypothesisId,
      sessionId,
      clientTimestamp: timestamp,
      data
    }
  });
  if (!accepted) return NextResponse.json({ ok: true, requestId, skipped: true });

  return NextResponse.json({ ok: true, requestId });
}
