import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}`, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) },
    /** 成片任务 result 可能含较大 audio_hex，避免默认 10s 截断导致前端解析不完整 */
    timeoutMs: 120_000
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const body = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/cancel`, {
    method: "POST",
    payload: body || "{}",
    body: body || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/delete`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
