import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: Promise<{ ipId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ipId } = await params;
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/author-ips/${encodeURIComponent(ipId)}/domains`, {
    method: "PATCH",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
