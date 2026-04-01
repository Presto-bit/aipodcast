import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyEventStreamFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const afterId = req.nextUrl.searchParams.get("after_id") || "0";
  const qpToken = (req.nextUrl.searchParams.get("access_token") || "").trim();
  const path = `/api/v1/jobs/${params.jobId}/events?after_id=${encodeURIComponent(afterId)}`;
  const fromReq = incomingAuthHeadersFrom(req);
  const headers: Record<string, string> = { ...fromReq };
  if (!headers.authorization && qpToken) {
    headers.authorization = `Bearer ${qpToken}`;
  }
  return proxyEventStreamFromOrchestrator(path, {
    payload: "{}",
    headers
  });
}
