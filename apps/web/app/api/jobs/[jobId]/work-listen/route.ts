import { NextRequest } from "next/server";
import {
  incomingAuthHeadersFrom,
  ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
  proxyJsonFromOrchestrator
} from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${encodeURIComponent(params.jobId)}/work-listen`, {
    method: "GET",
    payload: "{}",
    timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
