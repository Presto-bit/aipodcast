import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Ctx = { params: Promise<{ jobId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { jobId } = await ctx.params;
  const path = `/api/v1/jobs/${encodeURIComponent(jobId)}/share-ai-copy`;
  const raw = await req.text();
  const body = raw.trim().length ? raw : "{}";
  return proxyJsonFromOrchestrator(path, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
