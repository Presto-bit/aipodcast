import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/notebooks/onboarding-starter", {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
