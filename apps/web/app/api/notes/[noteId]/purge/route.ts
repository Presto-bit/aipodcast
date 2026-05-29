import { NextRequest } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: Promise<{ noteId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const { noteId } = await params;
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(noteId)}/purge`, {
    method: "DELETE",
    payload: "{}",
    body: null,
    headers: { ...incomingAuthHeadersFrom(req) },
    requestId
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { noteId } = await params;
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(noteId)}/purge`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    requestId
  });
}
