import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyBinaryFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const raw = await req.text();
  return proxyBinaryFromOrchestrator(`/api/v1/jobs/${params.jobId}/audio-export`, {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
