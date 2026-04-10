import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { jobId } = await ctx.params;
  const q = new URL(req.url).searchParams.toString();
  const path = `/api/v1/jobs/${encodeURIComponent(jobId)}/distribution-pack${q ? `?${q}` : ""}`;
  return proxyJsonFromOrchestrator(path, {
    method: "GET",
    headers: incomingAuthHeadersFrom(req),
    timeoutMs: 60_000
  });
}
