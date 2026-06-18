"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { getDeviceId } from "../lib/deviceId";
import { classifyUvZone } from "../lib/uvZone";

const VISITOR_COOKIE = "_fym_vid";
const VISITOR_STORAGE = "fym_visitor_id_v1";
/** v2：仅 device_visitor_id 计 UV 后需重新上报（v1 可能已误标今日已发送） */
const UV_SENT_DAY_KEY = "fym_uv_sent_sh_day_v3";
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

function uvSentStorageKey(zone: string): string {
  return `${UV_SENT_DAY_KEY}:${zone}`;
}

function alreadySentUvToday(zone: string): boolean {
  try {
    return sessionStorage.getItem(uvSentStorageKey(zone)) === shanghaiCalendarDay();
  } catch {
    return false;
  }
}

function markUvSentToday(zone: string): void {
  try {
    sessionStorage.setItem(uvSentStorageKey(zone), shanghaiCalendarDay());
  } catch {
    // ignore
  }
}

/** 站点 UV 埋点：按 zone 分区；/admin 不上报；每设备每 zone 每 Shanghai 日最多一次。 */
export default function SiteVisitorBeacon(): null {
  const pathname = usePathname() || "/";

  useEffect(() => {
    const zone = classifyUvZone(pathname);
    if (!zone) return;
    if (alreadySentUvToday(zone)) return;

    const run = () => {
      void (async () => {
        const { deviceId } = await getDeviceId();
        const payload = {
          visitor_id: ensureVisitorId(),
          device_visitor_id: deviceId,
          path: pathname,
          uv_zone: zone
        };
        try {
          const res = await fetch("/api/analytics/visitor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
            keepalive: true
          });
          if (res.ok) markUvSentToday(zone);
        } catch {
          // 埋点失败不影响主流程；未标记已发送，下次进页可重试
        }
      })();
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 8000 });
    } else {
      setTimeout(run, 300);
    }
  }, [pathname]);

  return null;
}
