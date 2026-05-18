import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/title-suggestions`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
