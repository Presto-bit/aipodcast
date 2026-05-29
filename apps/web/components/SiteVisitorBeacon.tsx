"use client";

import { useEffect } from "react";

const VISITOR_COOKIE = "_fym_vid";
const VISITOR_STORAGE = "fym_visitor_id_v1";
const UV_SENT_DAY_KEY = "fym_uv_sent_sh_day_v1";
const SITE_TRAFFIC_TZ = "Asia/Shanghai";

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
    vid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  writeCookie(VISITOR_COOKIE, vid);
  try {
    localStorage.setItem(VISITOR_STORAGE, vid);
  } catch {
    // ignore
  }
  return vid;
}

function shanghaiCalendarDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TRAFFIC_TZ }).format(new Date());
}

function alreadySentUvToday(): boolean {
  try {
    return sessionStorage.getItem(UV_SENT_DAY_KEY) === shanghaiCalendarDay();
  } catch {
    return false;
  }
}

function markUvSentToday(): void {
  try {
    sessionStorage.setItem(UV_SENT_DAY_KEY, shanghaiCalendarDay());
  } catch {
    // ignore
  }
}

/** 站点 UV 埋点：每个访客每个 Shanghai 日历日最多上报一次，不随路由切换重复请求。 */
export default function SiteVisitorBeacon(): null {
  useEffect(() => {
    if (alreadySentUvToday()) return;

    const visitorId = ensureVisitorId();
    const payload = JSON.stringify({ visitor_id: visitorId });
    const send = () => {
      void fetch("/api/analytics/visitor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: payload,
        keepalive: true
      })
        .then((res) => {
          if (res.ok) markUvSentToday();
        })
        .catch(() => {
          // 埋点失败不影响主流程
        });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(send, { timeout: 2000 });
    } else {
      setTimeout(send, 300);
    }
  }, []);

  return null;
}
