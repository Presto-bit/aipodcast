"use client";

import { getDeviceId } from "./deviceId";

export type FunnelStep =
  | "marketing_cta_listen"
  | "marketing_cta_register"
  | "register_page_view"
  | "register_send_code"
  | "guest_generate_click"
  | "guest_generate_register_confirm";

type TrackOptions = {
  status?: "succeeded" | "failed";
  meta?: Record<string, string>;
};

/** 转化漏斗埋点：写入 usage_events.metric = funnel_{step} */
export async function trackFunnelEvent(step: FunnelStep, options: TrackOptions = {}): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { deviceId } = await getDeviceId();
    await fetch("/api/analytics/funnel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        step,
        status: options.status ?? "succeeded",
        device_visitor_id: deviceId,
        meta: options.meta ?? {}
      }),
      keepalive: true
    });
  } catch {
    // 埋点失败不影响主流程
  }
}
