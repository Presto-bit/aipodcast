import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyBinaryFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const path = `/api/v1/jobs/${params.jobId}/cover`;
  return proxyBinaryFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    forceBinarySuccessStatus: 200,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
