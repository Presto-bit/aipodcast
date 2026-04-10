import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function DELETE(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/purge`, {
    method: "DELETE",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/purge`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
