import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.toString();
  const path = q ? `/api/v1/clip/projects?${q}` : "/api/v1/clip/projects";
  return proxyJsonFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/clip/projects", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
