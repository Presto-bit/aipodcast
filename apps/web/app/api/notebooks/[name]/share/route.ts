import { NextRequest } from "next/server";
import { getOrCreateRequestId, incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { name: string } };

async function proxyNotebookShareWrite(req: NextRequest, { params }: Params, method: "PATCH" | "POST") {
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
    method,
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    requestId
  });
}

export async function PATCH(req: NextRequest, params: Params) {
  return proxyNotebookShareWrite(req, params, "PATCH");
}

export async function POST(req: NextRequest, params: Params) {
  return proxyNotebookShareWrite(req, params, "POST");
}
