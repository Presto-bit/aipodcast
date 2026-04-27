import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notes/${params.noteId}/reindex`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
