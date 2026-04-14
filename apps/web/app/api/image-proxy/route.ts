import { NextRequest, NextResponse } from "next/server";
import { allowImageProxyPerIp, clientIpFromNextRequest } from "../../../lib/authRouteRateLimit";
import {
  isImageProxyHostAllowedBySuffixList,
  isImageProxyUrlBlocked,
  parseImageProxyHostSuffixes,
  validateImageProxyBody
} from "../../../lib/imageProxyGuards";
import { incomingAuthHeadersFrom } from "../../../lib/bff";

const hostSuffixes = parseImageProxyHostSuffixes(process.env.IMAGE_PROXY_HOST_SUFFIXES);

function imageProxyUnauthAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.IMAGE_PROXY_ALLOW_UNAUTHENTICATED || "").trim() === "1"
  );
}

/** 为「我的作品」封面等外链图提供同源代理；须登录（生产），并可配置主机后缀白名单 */
export async function GET(req: NextRequest) {
  if (!allowImageProxyPerIp(clientIpFromNextRequest(req))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const authHdrs = incomingAuthHeadersFrom(req);
  if (!authHdrs.authorization && !imageProxyUnauthAllowed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("url");
  if (!raw?.trim()) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(decodeURIComponent(raw));
  } catch {
    try {
      parsed = new URL(raw);
    } catch {
      return NextResponse.json({ error: "invalid url" }, { status: 400 });
    }
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "bad protocol" }, { status: 400 });
  }
  if (isImageProxyUrlBlocked(parsed)) {
    return NextResponse.json({ error: "blocked host" }, { status: 403 });
  }
  if (!isImageProxyHostAllowedBySuffixList(parsed.hostname, hostSuffixes)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        Accept: "image/*,*/*",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      },
      next: { revalidate: 3600 }
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    const ctHeader = upstream.headers.get("content-type");
    const buf = await upstream.arrayBuffer();
    const validated = validateImageProxyBody(buf, ctHeader);
    if (!validated.ok) {
      return NextResponse.json({ error: "not an image" }, { status: 415 });
    }
    return new NextResponse(buf, {
      headers: {
        "content-type": validated.contentType,
        "cache-control": "public, max-age=300, s-maxage=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
