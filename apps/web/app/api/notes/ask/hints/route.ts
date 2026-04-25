import { NextRequest } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  proxyJsonFromOrchestrator
} from "../../../../../lib/bff";

/** 与 `/api/notes/ask` 默认一致；线上可通过 NOTES_ASK_HINTS_UPSTREAM_TIMEOUT_MS（30000～600000）覆盖 */
function notesAskHintsUpstreamTimeoutMs(): number {
  const raw = (process.env.NOTES_ASK_HINTS_UPSTREAM_TIMEOUT_MS || "").trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 30_000 && n <= 600_000) return n;
  }
  return 180_000;
}

/** 须不小于 ceil(hints 上游超时秒数)，否则 BFF 未返回就被平台切断 */
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator("/api/v1/notes/ask/hints", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: notesAskHintsUpstreamTimeoutMs(),
    requestId,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
