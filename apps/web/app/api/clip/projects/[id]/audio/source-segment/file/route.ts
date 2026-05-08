import type { NextRequest } from "next/server";
import {
  describeOrchestratorUnreachable,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 分段素材试听：同源代理 + Range，行为与主音频 file 一致 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const q = req.nextUrl.searchParams.get("object_key") || "";
  if (!q.trim()) {
    return Response.json({ success: false, detail: "缺少 object_key" }, { status: 400 });
  }
  const rid = getOrCreateRequestId(req);
  const qEnc = encodeURIComponent(q);
  try {
    const upstream = await fetchOrchestrator(
      `/api/v1/clip/projects/${encodeURIComponent(id)}/audio/source-segment/file?object_key=${qEnc}`,
      {
        method: "GET",
        body: null,
        payload: "{}",
        headers: {
          ...incomingAuthHeadersFrom(req),
          ...(req.headers.get("range") ? { Range: req.headers.get("range")! } : {})
        },
        timeoutMs: 300_000,
        requestId: rid
      }
    );
    if (!upstream.ok) {
      const t = await upstream.text();
      return new Response(t, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "text/plain; charset=utf-8" }
      });
    }
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const cl = upstream.headers.get("content-length");
    const ar = upstream.headers.get("accept-ranges");
    const cr = upstream.headers.get("content-range");
    const headers = new Headers();
    headers.set("content-type", ct);
    if (cl) headers.set("content-length", cl);
    if (ar) headers.set("accept-ranges", ar);
    if (cr) headers.set("content-range", cr);
    headers.set("cache-control", "private, max-age=60");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return Response.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503 }
    );
  }
}
