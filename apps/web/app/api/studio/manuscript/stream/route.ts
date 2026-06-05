import { NextRequest } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  proxySsePostFromOrchestrator
} from "../../../../../lib/bff";

const STUDIO_STREAM_TIMEOUT_MS = 0;

export const maxDuration = 180;

/** Studio 成稿/改版 SSE：与编排器 /api/v1/studio/manuscript/stream 对齐 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  return proxySsePostFromOrchestrator("/api/v1/studio/manuscript/stream", {
    body: raw || "{}",
    timeoutMs: STUDIO_STREAM_TIMEOUT_MS,
    requestId,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
