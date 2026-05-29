"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const VISITOR_COOKIE = "_fym_vid";
const VISITOR_STORAGE = "fym_visitor_id_v1";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";").map((x) => x.trim());
  for (const part of parts) {
    if (!part.startsWith(`${name}=`)) continue;
    return decodeURIComponent(part.slice(name.length + 1));
  }
  return "";
}

function writeCookie(name: string, value: string): void {
  const maxAge = 60 * 60 * 24 * 400;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function ensureVisitorId(): string {
  let vid = readCookie(VISITOR_COOKIE).trim();
  if (vid.length >= 8) return vid;
  try {
    vid = String(localStorage.getItem(VISITOR_STORAGE) || "").trim();
  } catch {
    vid = "";
  }
  if (vid.length < 8) {
    vid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  writeCookie(VISITOR_COOKIE, vid);
  try {
    localStorage.setItem(VISITOR_STORAGE, vid);
  } catch {
    // ignore
  }
  return vid;
}

function shouldTrackPath(path: string): boolean {
  if (!path || path.startsWith("/api/") || path.startsWith("/_next/")) return false;
  return true;
}

/** 站点 PV 埋点：路由变化时上报，供管理端 T+1 PV/UV 统计。 */
export default function SitePageViewBeacon(): null {
  const pathname = usePathname();
  const search = useSearchParams();
  const lastKey = useRef("");

  useEffect(() => {
    const path = `${pathname || "/"}${search?.toString() ? `?${search.toString()}` : ""}`;
    if (!shouldTrackPath(pathname || "/")) return;
    const key = path;
    if (lastKey.current === key) return;
    lastKey.current = key;

    const visitorId = ensureVisitorId();
    void fetch("/api/analytics/page-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ visitor_id: visitorId, path }),
      keepalive: true
    }).catch(() => {
      // 埋点失败不影响主流程
    });
  }, [pathname, search]);

  return null;
}
