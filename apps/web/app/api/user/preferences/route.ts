import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/user/preferences", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function PATCH(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/user/preferences", {
    method: "PATCH",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
