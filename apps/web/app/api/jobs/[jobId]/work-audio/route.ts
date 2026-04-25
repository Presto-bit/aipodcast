import type { NextRequest } from "next/server";
import {
  describeOrchestratorUnreachable,
  fetchOrchestrator,
  getOrCreateRequestId,
  incomingAuthHeadersFrom
} from "../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { jobId: string } };

/**
 * 同源流式代理「我的作品」成片 MP3：浏览器不直连 MinIO，经编排器内网读桶（支持 Range）。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const rid = getOrCreateRequestId(req);
  const range = (req.headers.get("range") || "").trim();
  const headers: Record<string, string> = { ...incomingAuthHeadersFrom(req) };
  if (range) headers.range = range;
  try {
    const upstream = await fetchOrchestrator(
      `/api/v1/jobs/${encodeURIComponent(params.jobId)}/work-audio`,
      {
        method: "GET",
        body: null,
        payload: "{}",
        headers,
        requestId: rid,
        longLivedGet: true,
        retryGetOnce: false
      }
    );
    if (!upstream.ok) {
      const t = await upstream.text();
      const out = new Headers();
      out.set("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      const orid = (upstream.headers.get("x-request-id") || "").trim();
      if (orid) out.set("x-request-id", orid);
      return new Response(t, { status: upstream.status, headers: out });
    }
    const ct = upstream.headers.get("content-type") || "audio/mpeg";
    const cl = upstream.headers.get("content-length");
    const ar = upstream.headers.get("accept-ranges");
    const cr = upstream.headers.get("content-range");
    const out = new Headers();
    out.set("content-type", ct);
    if (cl) out.set("content-length", cl);
    if (ar) out.set("accept-ranges", ar);
    if (cr) out.set("content-range", cr);
    out.set("cache-control", "private, max-age=60");
    const orid = (upstream.headers.get("x-request-id") || "").trim();
    if (orid) out.set("x-request-id", orid);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    return Response.json(
      {
        success: false,
        error: "upstream_unreachable",
        detail: describeOrchestratorUnreachable(e),
        request_id: rid,
        requestId: rid
      },
      { status: 503, headers: { "x-request-id": rid } }
    );
  }
}
