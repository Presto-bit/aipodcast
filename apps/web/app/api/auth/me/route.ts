import { NextRequest } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  ORCHESTRATOR_TIMEOUT_AUTH_MS,
  proxyJsonFromOrchestrator
} from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/auth/me", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) },
    timeoutMs: ORCHESTRATOR_TIMEOUT_AUTH_MS,
    requestId: getOrCreateRequestId(req)
  });
}
