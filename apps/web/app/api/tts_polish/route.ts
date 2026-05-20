import { NextRequest } from "next/server";
import { allowTtsPolish, rateLimitedResponse } from "../../../lib/aiRouteRateLimit";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../lib/bff";

export async function POST(req: NextRequest) {
  if (!(await allowTtsPolish(req))) {
    return rateLimitedResponse();
  }
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/polish_tts_text", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
