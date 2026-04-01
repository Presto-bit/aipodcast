import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function DELETE(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(params.noteId)}/purge`, {
    method: "DELETE",
    payload: "{}",
    body: null,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
