import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyBinaryFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { name: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const v = req.nextUrl.searchParams.get("variant") || "thumb";
  const path = `/api/v1/notebooks/${encodeURIComponent(params.name)}/cover?variant=${encodeURIComponent(v)}`;
  return proxyBinaryFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const raw = Buffer.from(await req.arrayBuffer());
  const ct = req.headers.get("content-type") || "application/octet-stream";
  const path = `/api/v1/notebooks/${encodeURIComponent(params.name)}/cover`;
  return proxyBinaryFromOrchestrator(path, {
    method: "POST",
    body: raw,
    payload: "{}",
    headers: { "content-type": ct, ...incomingAuthHeadersFrom(req) }
  });
}
