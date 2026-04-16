import type { NextRequest } from "next/server";
import {
  describeOrchestratorUnreachable,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 同源流式代理剪辑源音频，避免整文件读入 BFF 内存；波形与试听共用。
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const rid = getOrCreateRequestId(req);
  try {
    const upstream = await fetchOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/audio/file`, {
      method: "GET",
      body: null,
      payload: "{}",
      headers: { ...incomingAuthHeadersFrom(req) },
      timeoutMs: 300_000,
      requestId: rid
    });
    if (!upstream.ok) {
      const t = await upstream.text();
      return new Response(t, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "text/plain; charset=utf-8" }
      });
    }
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const cd = upstream.headers.get("content-disposition");
    const headers = new Headers();
    headers.set("content-type", ct);
    if (cd) headers.set("content-disposition", cd);
    headers.set("cache-control", "private, max-age=60");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return Response.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503 }
    );
  }
}
