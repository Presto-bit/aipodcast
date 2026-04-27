import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/user/preferences", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

async function proxyPreferencesWrite(req: NextRequest, method: "PATCH" | "POST") {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/user/preferences", {
    method,
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}

export async function PATCH(req: NextRequest) {
  return proxyPreferencesWrite(req, "PATCH");
}

export async function POST(req: NextRequest) {
  return proxyPreferencesWrite(req, "POST");
}
