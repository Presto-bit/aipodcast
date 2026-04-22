import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

const NOTES_ASK_HINTS_TIMEOUT_MS = 120_000;

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/notes/ask/hints", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: NOTES_ASK_HINTS_TIMEOUT_MS,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
