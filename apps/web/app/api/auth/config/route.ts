import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/auth/config", {
    method: "GET",
    payload: "{}",
    timeoutMs: 8000,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
