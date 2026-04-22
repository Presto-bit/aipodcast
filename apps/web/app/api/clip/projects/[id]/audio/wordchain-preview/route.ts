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

/** 代理词链试听 MP3（与导出同算法；POST 生成后 GET 流式播放） */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const rid = getOrCreateRequestId(req);
  try {
    const upstream = await fetchOrchestrator(
      `/api/v1/clip/projects/${encodeURIComponent(id)}/audio/wordchain-preview`,
      {
        method: "GET",
        body: null,
        payload: "{}",
        headers: { ...incomingAuthHeadersFrom(req) },
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
    const cd = upstream.headers.get("content-disposition");
    const cl = upstream.headers.get("content-length");
    const ar = upstream.headers.get("accept-ranges");
    const cr = upstream.headers.get("content-range");
    const headers = new Headers();
    headers.set("content-type", ct);
    if (cd) headers.set("content-disposition", cd);
    if (cl) headers.set("content-length", cl);
    if (ar) headers.set("accept-ranges", ar);
    if (cr) headers.set("content-range", cr);
    headers.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return Response.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const rid = getOrCreateRequestId(req);
  try {
    const rawBody = (await req.text().catch(() => "")) || "{}";
    const upstream = await fetchOrchestrator(
      `/api/v1/clip/projects/${encodeURIComponent(id)}/audio/wordchain-preview`,
      {
        method: "POST",
        body: rawBody,
        payload: "{}",
        headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
        timeoutMs: 600_000,
        requestId: rid
      }
    );
    const t = await upstream.text();
    return new Response(t, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8" }
    });
  } catch (e) {
    return Response.json(
      { success: false, error: "upstream_unreachable", detail: describeOrchestratorUnreachable(e) },
      { status: 503 }
    );
  }
}
