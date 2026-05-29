import { NextRequest } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator("/api/v1/notes/trash/restore", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    requestId
  });
}
