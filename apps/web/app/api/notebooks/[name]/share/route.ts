import { NextRequest } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { name: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const raw = await req.text();
  const requestId = getOrCreateRequestId(req);
  const nameRaw = String(params?.name || "");
  let notebookName = nameRaw;
  try {
    notebookName = decodeURIComponent(nameRaw);
  } catch {
    notebookName = nameRaw;
  }
  return proxyJsonFromOrchestrator(`/api/v1/notebooks/${encodeURIComponent(notebookName)}/share`, {
    method: "PATCH",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    requestId
  });
}
