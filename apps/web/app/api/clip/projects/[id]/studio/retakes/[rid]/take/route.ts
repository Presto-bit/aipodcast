import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; rid: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, rid } = await ctx.params;
  const raw = await req.arrayBuffer();
  const headers: Record<string, string> = { ...incomingAuthHeadersFrom(req) };
  const fn = req.headers.get("x-clip-filename");
  const mime = req.headers.get("x-clip-mime");
  if (fn) headers["x-clip-filename"] = fn;
  if (mime) headers["x-clip-mime"] = mime;
  return proxyJsonFromOrchestrator(
    `/api/v1/clip/projects/${encodeURIComponent(id)}/studio/retakes/${encodeURIComponent(rid)}/take`,
    {
      method: "POST",
      body: Buffer.from(raw),
      payload: "{}",
      headers,
      timeoutMs: 120_000
    }
  );
}
