import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}`, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: null,
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
