import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyBinaryFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const q = req.nextUrl.searchParams.toString();
  const path = q
    ? `/api/v1/notes/${params.noteId}/file?${q}`
    : `/api/v1/notes/${params.noteId}/file`;
  return proxyBinaryFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
