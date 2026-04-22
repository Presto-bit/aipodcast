import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/admin/jobs/${params.jobId}/podcast-template`, {
    method: "PATCH",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
