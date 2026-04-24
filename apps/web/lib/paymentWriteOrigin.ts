import type { NextRequest } from "next/server";

/**
 * 浏览器发起的支付/钱包写操作：校验 Origin 或 Referer 与本站一致，降低跨站请求伪造面。
 * 无 Origin 且无 Referer 时放行（curl、部分原生容器、自动化）。
 */
export function paymentWriteOriginAllowed(req: NextRequest): boolean {
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
    add(new URL(req.url).origin);
  } catch {
    /* noop */
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
