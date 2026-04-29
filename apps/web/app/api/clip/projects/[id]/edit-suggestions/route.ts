import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const raw = await req.text();
  return proxyJsonFromOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/edit-suggestions`, {
    method: "POST",
    body: raw || "{}",
    payload: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 180_000
  });
}
