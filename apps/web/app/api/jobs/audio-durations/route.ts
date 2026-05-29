import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  const body = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/jobs/audio-durations", {
    method: "POST",
    payload: body || "{}",
    body: body || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
