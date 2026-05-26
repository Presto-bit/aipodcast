import { NextRequest } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  proxySsePostFromOrchestrator
} from "../../../../../../lib/bff";

type Params = { params: Promise<{ ipId: string }> };

export const maxDuration = 180;

export async function POST(req: NextRequest, { params }: Params) {
  const { ipId } = await params;
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  return proxySsePostFromOrchestrator(
    `/api/v1/author-ips/${encodeURIComponent(ipId)}/compose/stream`,
    {
      body: raw || "{}",
      timeoutMs: 0,
      requestId,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
    }
  );
}
