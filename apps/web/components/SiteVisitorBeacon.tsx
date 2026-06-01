"use client";

import { useEffect } from "react";
import { getDeviceId } from "../lib/deviceId";

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

/** 站点 UV 埋点：仅设备 ID；每设备每 Shanghai 日历日最多上报一次。 */
export default function SiteVisitorBeacon(): null {
  useEffect(() => {
    if (alreadySentUvToday()) return;

    const run = () => {
      void (async () => {
        const device = await getDeviceId();
        if (!device) return;
        const payload = {
          visitor_id: ensureVisitorId(),
          device_visitor_id: device.deviceId
        };
        try {
          const res = await fetch("/api/analytics/visitor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
            keepalive: true
          });
          if (res.ok) markUvSentToday();
        } catch {
          // 埋点失败不影响主流程
        }
      })();
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 5000 });
    } else {
      setTimeout(run, 300);
    }
  }, []);

  return null;
}
