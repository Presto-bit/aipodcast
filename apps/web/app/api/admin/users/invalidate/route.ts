import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/admin/users/invalidate", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
