import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

async function proxyProfileWrite(req: NextRequest, method: "PATCH" | "POST") {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/auth/profile", {
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
  return proxyProfileWrite(req, "PATCH");
}

export async function POST(req: NextRequest) {
  return proxyProfileWrite(req, "POST");
}
