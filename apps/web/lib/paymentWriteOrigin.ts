import type { NextRequest } from "next/server";

/**
 * 浏览器发起的支付/钱包写操作：校验 Origin 或 Referer 与本站一致，降低跨站请求伪造面。
 * 无 Origin 且无 Referer 时放行（curl、部分原生容器、自动化）。
 */
export function paymentWriteOriginAllowed(req: NextRequest): boolean {
  /** 现代浏览器同源 fetch 会带此头；部分代理/容器下 Origin 与 Host 不一致时仍可判定为同源导航触发。 */
  const secFetchSite = (req.headers.get("sec-fetch-site") || "").trim().toLowerCase();
  if (secFetchSite === "same-origin") return true;

  const origins = collectAllowedOrigins(req);
  if (origins.size === 0) return true;

  const originHdr = (req.headers.get("origin") || "").trim();
  if (originHdr) {
    return origins.has(originHdr);
  }

  const referer = (req.headers.get("referer") || "").trim();
  if (!referer) return true;
  try {
    return origins.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

function collectAllowedOrigins(req: NextRequest): Set<string> {
  const out = new Set<string>();
  const add = (o: string) => {
    const t = o.trim();
    if (!t) return;
    try {
      out.add(new URL(t).origin);
    } catch {
      /* noop */
    }
  };
  try {
    add(req.nextUrl.origin);
  } catch {
    /* noop */
  }
  try {
    add(new URL(req.url).origin);
  } catch {
    /* noop */
  }

  const xfHost = (req.headers.get("x-forwarded-host") || "").split(",")[0]?.trim();
  const hostHdr = (req.headers.get("host") || "").split(",")[0]?.trim();
  const xfProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase();
  const protos = [xfProto, req.nextUrl.protocol.replace(":", "").toLowerCase()].filter(
    (p): p is string => Boolean(p && (p === "http" || p === "https"))
  );
  const protoList = protos.length ? [...new Set(protos)] : ["https"];
  for (const hostRaw of [xfHost, hostHdr]) {
    if (!hostRaw) continue;
    const hostOnly = hostRaw.split(":")[0] || "";
    if (!/^[\w.-]+$/.test(hostOnly)) continue;
    for (const p of protoList) {
      add(`${p}://${hostRaw}`);
    }
  }

  for (const o of [...out]) {
    try {
      const u = new URL(o);
      if (u.hostname === "127.0.0.1") add(o.replace("://127.0.0.1", "://localhost"));
      if (u.hostname === "localhost") add(o.replace("://localhost", "://127.0.0.1"));
    } catch {
      /* noop */
    }
  }
  const extra = (process.env.PAYMENT_WRITE_EXTRA_ORIGINS || "").split(",");
  for (const raw of extra) add(raw);
  return out;
}
