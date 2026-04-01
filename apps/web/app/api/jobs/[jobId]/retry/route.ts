import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const body = (await req.text().catch(() => "")) || "{}";
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/retry`, {
    method: "POST",
    payload: body,
    body,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
