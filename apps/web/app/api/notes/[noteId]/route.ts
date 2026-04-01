import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/notes/${params.noteId}`, {
    method: "PATCH",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notes/${params.noteId}`, {
    method: "DELETE",
    payload: "{}",
    body: null,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
