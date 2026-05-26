import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../../lib/bff";

type Params = { params: Promise<{ ipId: string; noteId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ipId, noteId } = await params;
  const body = await req.text();
  return proxyJsonFromOrchestrator(
    `/api/v1/author-ips/${encodeURIComponent(ipId)}/materials/${encodeURIComponent(noteId)}/learning`,
    {
      method: "PATCH",
      payload: body,
      body,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
    }
  );
}
