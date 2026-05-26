import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: Promise<{ ipId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { ipId } = await params;
  return proxyJsonFromOrchestrator(`/api/v1/author-ips/${encodeURIComponent(ipId)}/learn`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
