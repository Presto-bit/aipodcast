import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/silences`, {
    method: "GET",
    headers: { ...incomingAuthHeadersFrom(req) },
    timeoutMs: 600_000
  });
}
