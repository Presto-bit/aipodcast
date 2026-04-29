"use client";

const POST_AUTH_ACTION_KEY = "fym_post_auth_action";
const POST_AUTH_ACTION_TTL_MS = 30 * 60 * 1000;

type PostAuthActionPayload = {
  path: string;
  action: string;
  at: number;
};

function sanitizePath(raw: string | null | undefined): string | null {
  const v = String(raw || "").trim();
  if (!v || !v.startsWith("/") || v.startsWith("//")) return null;
  return v;
}

export function rememberPostAuthAction(path: string, action: string): void {
  if (typeof window === "undefined") return;
  const safePath = sanitizePath(path);
  const safeAction = String(action || "").trim();
  if (!safePath || !safeAction) return;
  const payload: PostAuthActionPayload = { path: safePath, action: safeAction, at: Date.now() };
  try {
    window.sessionStorage.setItem(POST_AUTH_ACTION_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function consumePostAuthActionForCurrentPath(allowedActions: readonly string[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(POST_AUTH_ACTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PostAuthActionPayload;
    const now = Date.now();
    if (!parsed || typeof parsed !== "object" || now - Number(parsed.at || 0) > POST_AUTH_ACTION_TTL_MS) {
      window.sessionStorage.removeItem(POST_AUTH_ACTION_KEY);
      return null;
    }
    const path = sanitizePath(parsed.path);
    const action = String(parsed.action || "").trim();
    if (!path || !action) {
      window.sessionStorage.removeItem(POST_AUTH_ACTION_KEY);
      return null;
    }
    if (window.location.pathname !== path) return null;
    if (!allowedActions.includes(action)) return null;
    window.sessionStorage.removeItem(POST_AUTH_ACTION_KEY);
    return action;
  } catch {
    return null;
  }
}
