import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom } from "../../../lib/bff";
import { sanitizeClientDiagnosticsValue } from "../../../lib/clientDiagnosticsSanitize";

const MAX_BODY_BYTES = 28_000;

/**
 * 浏览器端笔记本分享诊断上报（生产可检索）。
 * 运维在日志平台检索 JSON 字段 `type":"notebook_share_client"` 或全文 `notebook_share_client`。
 * 关闭：`NOTEBOOK_SHARE_SERVER_DIAGNOSTICS=0`
 */
export async function POST(req: NextRequest) {
  if (process.env.NOTEBOOK_SHARE_SERVER_DIAGNOSTICS === "0") {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }
  const auth = incomingAuthHeadersFrom(req);
  if (!auth.authorization) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
  const requestId = getOrCreateRequestId(req);
  const hypothesisId =
    typeof rec.hypothesisId === "string" ? rec.hypothesisId.slice(0, 48) : undefined;
  const location = typeof rec.location === "string" ? rec.location.slice(0, 240) : undefined;
  const message =
    typeof rec.message === "string" ? rec.message.slice(0, 600) : "notebook_share_client_message_missing";
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId.slice(0, 80) : undefined;
  const timestamp = typeof rec.timestamp === "number" && Number.isFinite(rec.timestamp) ? rec.timestamp : undefined;
  const data = sanitizeClientDiagnosticsValue(rec.data ?? {}, 4, 8000);

  const line = JSON.stringify({
    type: "notebook_share_client",
    ts: new Date().toISOString(),
    requestId,
    hypothesisId,
    location,
    message,
    sessionId,
    clientTimestamp: timestamp,
    data
  });
  console.log(line);

  return NextResponse.json({ ok: true, requestId });
}
