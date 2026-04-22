import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { noteId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const q = req.nextUrl.searchParams.toString();
  const path = q
    ? `/api/v1/notes/${params.noteId}/preview_text?${q}`
    : `/api/v1/notes/${params.noteId}/preview_text`;
  return proxyJsonFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
