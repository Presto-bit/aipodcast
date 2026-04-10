import { NextRequest, NextResponse } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/jobs/preview-media", {
    method: "POST",
    payload: raw || "{}",
    body: raw,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
