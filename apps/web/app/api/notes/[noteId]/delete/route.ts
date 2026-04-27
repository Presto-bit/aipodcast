import { NextRequest } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(params.noteId)}/delete`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    requestId
  });
}
