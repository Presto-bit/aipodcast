import type { NextRequest } from "next/server";
import { fetchOrchestrator, incomingAuthHeadersFrom } from "../../../../../../../lib/bff";
import { decodeClipFilenameHeader, encodeClipFilenameForHttpHeader } from "../../../../../../../lib/clipFilenameHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const buf = Buffer.from(await req.arrayBuffer());
  const decoded = decodeClipFilenameHeader(
    req.headers.get("x-clip-filename") || "",
    "segment.mp3"
  ).slice(0, 240);
  const mime = (req.headers.get("content-type") || "application/octet-stream").trim();
  try {
    const upstream = await fetchOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/audio/stage`, {
      method: "POST",
      body: buf,
      payload: "{}",
      headers: {
        "x-clip-filename": encodeClipFilenameForHttpHeader(decoded, "segment.mp3"),
        "x-clip-mime": mime.slice(0, 120),
        ...incomingAuthHeadersFrom(req)
      },
      timeoutMs: 120_000
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" }
    });
  } catch {
    return Response.json(
      { success: false, error: "upstream_unreachable", detail: "orchestrator request failed" },
      { status: 503 }
    );
  }
}
