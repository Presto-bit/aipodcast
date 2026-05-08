import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const path = `/api/v1/clip/projects/${encodeURIComponent(id)}/share-ai-copy`;
  const raw = await req.text();
  const body = raw.trim().length ? raw : "{}";
  return proxyJsonFromOrchestrator(path, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
