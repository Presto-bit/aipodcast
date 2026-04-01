import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notes/${params.noteId}/preview_text`, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
