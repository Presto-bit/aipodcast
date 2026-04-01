import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyBinaryFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  return proxyBinaryFromOrchestrator(`/api/v1/notes/${params.noteId}/file`, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
