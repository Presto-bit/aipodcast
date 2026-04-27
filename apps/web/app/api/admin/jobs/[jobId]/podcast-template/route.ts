import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

type Params = { params: { jobId: string } };

async function proxyPodcastTemplateWrite(req: NextRequest, { params }: Params, method: "PATCH" | "POST") {
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/admin/jobs/${params.jobId}/podcast-template`, {
    method,
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}

export async function PATCH(req: NextRequest, params: Params) {
  return proxyPodcastTemplateWrite(req, params, "PATCH");
}

export async function POST(req: NextRequest, params: Params) {
  return proxyPodcastTemplateWrite(req, params, "POST");
}
