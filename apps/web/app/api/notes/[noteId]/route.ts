import { NextRequest } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

type Params = { params: { noteId: string } };

async function proxyNoteWrite(req: NextRequest, { params }: Params, method: "PATCH" | "POST") {
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(params.noteId)}`, {
    method,
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    requestId
  });
}

export async function PATCH(req: NextRequest, params: Params) {
  return proxyNoteWrite(req, params, "PATCH");
}

export async function POST(req: NextRequest, params: Params) {
  return proxyNoteWrite(req, params, "POST");
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const requestId = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(params.noteId)}`, {
    method: "DELETE",
    payload: "{}",
    body: null,
    headers: { ...incomingAuthHeadersFrom(req) },
    requestId
  });
}
