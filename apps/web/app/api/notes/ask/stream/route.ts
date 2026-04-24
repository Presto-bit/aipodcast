import { NextRequest } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  proxySsePostFromOrchestrator
} from "../../../../../lib/bff";

const NOTES_ASK_UPSTREAM_TIMEOUT_MS = 0;

/** 与编排器流式问答对齐：不设 Abort，由平台 maxDuration 约束 */
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  return proxySsePostFromOrchestrator("/api/v1/notes/ask/stream", {
    body: raw || "{}",
    timeoutMs: NOTES_ASK_UPSTREAM_TIMEOUT_MS,
    requestId,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
