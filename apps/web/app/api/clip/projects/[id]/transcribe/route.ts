import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/transcribe`, {
    method: "POST",
    body: "{}",
    payload: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 30_000
  });
}
