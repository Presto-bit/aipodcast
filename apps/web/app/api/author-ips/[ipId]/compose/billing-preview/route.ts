import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

type Params = { params: Promise<{ ipId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { ipId } = await params;
  const q = req.nextUrl.searchParams.toString();
  const path = q
    ? `/api/v1/author-ips/${encodeURIComponent(ipId)}/compose/billing-preview?${q}`
    : `/api/v1/author-ips/${encodeURIComponent(ipId)}/compose/billing-preview`;
  return proxyJsonFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
