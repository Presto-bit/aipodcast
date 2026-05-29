import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: Promise<{ noteId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { noteId } = await params;
  return proxyJsonFromOrchestrator(`/api/v1/notes/${encodeURIComponent(noteId)}/restore`, {
    method: "POST",
    payload: "{}",
    body: null,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
