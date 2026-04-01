import { NextRequest, NextResponse } from "next/server";

/** 为「我的作品」封面等外链图提供同源代理，避免 CDN 防盗链导致 <img> 不显示 */
export async function GET(req: NextRequest) {
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
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    return NextResponse.json({ error: "blocked host" }, { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        Accept: "image/*,*/*",
        // 部分图床对默认 UA/空 Referer 返回 403，与浏览器行为对齐以提高拉取成功率
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      },
      next: { revalidate: 3600 }
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "content-type": ct,
        "cache-control": "public, max-age=300, s-maxage=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
