import type { NextRequest } from "next/server";
import { clientIpFromNextRequest } from "./authRouteRateLimit";
import { allowSlidingWindow } from "./slidingRateLimit";

const WINDOW_SEC = 60;

/** 创建 TTS / 播客任务：每 IP 每分钟上限（与全站 middleware 400/min 叠加） */
const JOB_CREATE_PER_IP = 24;
/** 音色试听：成本高，单列更严 */
const PREVIEW_VOICE_PER_IP = 16;
/** TTS 文案润色 */
const TTS_POLISH_PER_IP = 40;

function principalKey(req: NextRequest): string {
  const auth = req.headers.get("authorization")?.trim();
  if (auth) return `auth:${auth.slice(0, 48)}`;
  return `ip:${clientIpFromNextRequest(req)}`;
}

export async function allowJobCreate(req: NextRequest): Promise<boolean> {
  const ip = clientIpFromNextRequest(req);
  const principal = principalKey(req);
  const okIp = await allowSlidingWindow(`job_create:ip:${ip}`, JOB_CREATE_PER_IP, WINDOW_SEC);
  if (!okIp) return false;
  return allowSlidingWindow(`job_create:user:${principal}`, JOB_CREATE_PER_IP, WINDOW_SEC);
}

export async function allowPreviewVoice(req: NextRequest): Promise<boolean> {
  const ip = clientIpFromNextRequest(req);
  const principal = principalKey(req);
  const okIp = await allowSlidingWindow(`preview_voice:ip:${ip}`, PREVIEW_VOICE_PER_IP, WINDOW_SEC);
  if (!okIp) return false;
  return allowSlidingWindow(`preview_voice:user:${principal}`, PREVIEW_VOICE_PER_IP, WINDOW_SEC);
}

export async function allowTtsPolish(req: NextRequest): Promise<boolean> {
  const ip = clientIpFromNextRequest(req);
  return allowSlidingWindow(`tts_polish:ip:${ip}`, TTS_POLISH_PER_IP, WINDOW_SEC);
}

export function rateLimitedResponse() {
  return new Response(JSON.stringify({ success: false, error: "rate_limited" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" }
  });
}
