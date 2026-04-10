import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyBinaryFromOrchestrator, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const q = new URL(req.url).searchParams.toString();
  const path = `/api/v1/jobs/${encodeURIComponent(params.jobId)}/cover${q ? `?${q}` : ""}`;
  const signed = new URL(req.url).searchParams.get("signed");
  if (signed === "1" || signed === "true") {
    return proxyJsonFromOrchestrator(path, {
      method: "GET",
      headers: { ...incomingAuthHeadersFrom(req) },
      timeoutMs: 60_000
    });
  }
  return proxyBinaryFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    forceBinarySuccessStatus: 200,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/cover`, {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
