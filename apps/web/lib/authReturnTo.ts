"use client";

const POST_AUTH_RETURN_TO_KEY = "fym_post_auth_return_to";

function sanitizeReturnTo(raw: string | null | undefined): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  return v;
}

export function rememberPostAuthReturnTo(path: string): void {
  if (typeof window === "undefined") return;
  const safe = sanitizeReturnTo(path);
  if (!safe) return;
  try {
    window.sessionStorage.setItem(POST_AUTH_RETURN_TO_KEY, safe);
  } catch {
    // ignore
  }
}

export function consumeRememberedPostAuthReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(POST_AUTH_RETURN_TO_KEY);
    window.sessionStorage.removeItem(POST_AUTH_RETURN_TO_KEY);
    return sanitizeReturnTo(raw);
  } catch {
    return null;
  }
}

export function consumePostAuthReturnTo(rawFromQuery?: string | null): string | null {
  const fromQuery = sanitizeReturnTo(rawFromQuery);
  if (fromQuery) return fromQuery;
  return consumeRememberedPostAuthReturnTo();
}
