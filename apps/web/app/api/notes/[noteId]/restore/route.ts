import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(params.noteId)}/restore`, {
    method: "POST",
    payload: "{}",
    body: null,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
