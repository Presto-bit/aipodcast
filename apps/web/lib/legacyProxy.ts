import { NextRequest, NextResponse } from "next/server";

const legacyBase =
  process.env.LEGACY_BACKEND_URL || process.env.NEXT_PUBLIC_LEGACY_BACKEND_URL || "http://127.0.0.1:5001";

function buildLegacyUrl(pathname: string, search: string): string {
  const base = legacyBase.endsWith("/") ? legacyBase.slice(0, -1) : legacyBase;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}${search || ""}`;
}

function passthroughRequestHeaders(req: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};
  for (const key of ["authorization", "content-type", "accept", "cookie", "range"]) {
    const value = req.headers.get(key);
    if (value) headers[key] = value;
  }
  return headers;
}

export async function proxyLegacy(req: NextRequest, apiPath: string): Promise<NextResponse> {
  const url = buildLegacyUrl(apiPath, req.nextUrl.search);
  const init: RequestInit = {
    method: req.method,
    headers: passthroughRequestHeaders(req),
    cache: "no-store",
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const buffer = await req.arrayBuffer();
    init.body = buffer.byteLength ? buffer : undefined;
  }

  const upstream = await fetch(url, init);
  const responseHeaders = new Headers();
  for (const key of ["content-type", "content-disposition", "cache-control", "location", "set-cookie"]) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

