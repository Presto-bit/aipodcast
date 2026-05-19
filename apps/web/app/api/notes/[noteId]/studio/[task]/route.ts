import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

type Params = { params: { noteId: string; task: string } };

export async function POST(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(params.noteId)}/studio/${encodeURIComponent(params.task)}`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
