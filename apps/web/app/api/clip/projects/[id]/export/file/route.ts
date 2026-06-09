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

/** 流式代理导出 MP3，带 attachment 头，供前端 blob 下载。 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const rid = getOrCreateRequestId(req);
  try {
    const upstream = await fetchOrchestrator(`/api/v1/clip/projects/${encodeURIComponent(id)}/export/file`, {
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
    const headers = new Headers();
    const ct = upstream.headers.get("content-type") || "audio/mpeg";
    headers.set("content-type", ct);
    const cd = upstream.headers.get("content-disposition");
    if (cd) headers.set("content-disposition", cd);
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    headers.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return Response.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503 }
    );
  }
}
