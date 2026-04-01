import { NextRequest } from "next/server";
import { fetchOrchestrator, incomingAuthHeadersFrom } from "../../../../../lib/bff";

type Params = { params: { slug: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const publicBaseUrl = host ? `${proto}://${host}` : "";
  const upstream = await fetchOrchestrator(`/api/v1/rss/feed/${encodeURIComponent(params.slug)}`, {
    method: "GET",
    payload: "{}",
    headers: {
      ...incomingAuthHeadersFrom(req),
      "x-public-base-url": publicBaseUrl
    }
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=60"
    }
  });
}
