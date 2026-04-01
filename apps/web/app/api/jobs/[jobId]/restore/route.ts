import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/restore`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
