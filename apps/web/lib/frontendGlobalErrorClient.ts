type GlobalErrorPayload = {
  source: "onerror" | "unhandledrejection";
  message: string;
  location?: string;
  data?: Record<string, unknown>;
};

const MAX_REPORTS_PER_PAGE = 20;
const DEDUPE_WINDOW_MS = 15_000;

const reportState = {
  sentCount: 0,
  dedupeMap: new Map<string, number>()
};

function trim(input: unknown, max = 1200): string {
  const s = String(input ?? "");
  return s.length <= max ? s : s.slice(0, max);
}

function nowMs(): number {
  return Date.now();
}

function dedupeKey(payload: GlobalErrorPayload): string {
  return `${payload.source}|${payload.message}|${payload.location || ""}`;
}

function canReport(payload: GlobalErrorPayload): boolean {
  if (reportState.sentCount >= MAX_REPORTS_PER_PAGE) return false;
  const key = dedupeKey(payload);
  const ts = nowMs();
  const last = reportState.dedupeMap.get(key) || 0;
  if (ts - last < DEDUPE_WINDOW_MS) return false;
  reportState.dedupeMap.set(key, ts);
  reportState.sentCount += 1;
  return true;
}

function generateTraceId(): string {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let out = "";
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i) & 0xff;
    out += code.toString(16).padStart(2, "0");
    if (out.length >= 32) break;
  }
  return out.padEnd(32, "0");
}

export function reportFrontendGlobalError(payload: GlobalErrorPayload): void {
  if (typeof window === "undefined") return;
  const normalized: GlobalErrorPayload = {
    source: payload.source,
    message: trim(payload.message),
    location: payload.location ? trim(payload.location, 240) : undefined,
    data: payload.data
  };
  if (!canReport(normalized)) return;
  fetch("/api/frontend-global-error", {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-id": generateTraceId() },
    credentials: "same-origin",
    body: JSON.stringify({
      ...normalized,
      route: window.location.pathname,
      release:
        (typeof process !== "undefined" &&
          process.env &&
          (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_VERSION)) ||
        "web-dev"
    })
  }).catch(() => {});
}
