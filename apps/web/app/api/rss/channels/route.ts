import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/rss/channels", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/rss/channels", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}

export async function PUT(req: NextRequest) {
  return POST(req);
}
