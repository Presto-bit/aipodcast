import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

type Params = { params: Promise<{ ipId: string; noteId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const { ipId, noteId } = await params;
  return proxyJsonFromOrchestrator(
    `/api/v1/author-ips/${encodeURIComponent(ipId)}/materials/${encodeURIComponent(noteId)}`,
    {
      method: "DELETE",
      payload: "{}",
      headers: { ...incomingAuthHeadersFrom(req) }
    }
  );
}
