export const LOG_SCOPES = ["notebook_share_client", "frontend_global_error"] as const;
export type LogScope = (typeof LOG_SCOPES)[number];
type LogLevel = "info" | "debug";

export type LogSwitchConfig = {
  scope: LogScope;
  enabled: boolean;
  env: string;
  minLevel: LogLevel;
  sampleRate: number;
  expiresAtMs: number | null;
  updatedAtMs: number;
  updatedBy: string;
  reason: string;
};

export type LogSwitchAuditEntry = {
  id: string;
  scope: LogScope;
  action: "enable" | "disable";
  env: string;
  minLevel: LogLevel;
  sampleRate: number;
  ttlMinutes: number | null;
  reason: string;
  operator: string;
  atMs: number;
};

export type LogEventEntry = {
  id: string;
  scope: LogScope;
  requestId: string;
  traceId: string;
  errorCode: string;
  level: "info" | "error";
  env: string;
  release: string;
  module: string;
  route: string;
  message: string;
  location?: string;
  payload: Record<string, unknown>;
  atMs: number;
};

export type LogEventFilters = {
  level?: "info" | "error";
  requestId?: string;
  errorCode?: string;
  fromMs?: number;
  toMs?: number;
};

export type LogErrorCluster = {
  key: string;
  errorCode: string;
  route: string;
  module: string;
  level: "info" | "error";
  count: number;
  latestAtMs: number;
};

type LogControlStore = {
  configByScope: Partial<Record<LogScope, LogSwitchConfig>>;
  audits: LogSwitchAuditEntry[];
  events: LogEventEntry[];
};

const STORE_KEY = "__fymLogControlStore";
const MAX_AUDIT_RECORDS = 120;
const MAX_EVENT_RECORDS = 400;

function appEnv(): string {
  const raw = String(process.env.APP_ENV || process.env.NODE_ENV || "development").trim().toLowerCase();
  if (!raw) return "development";
  return raw;
}

function appRelease(): string {
  const raw = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_VERSION || "dev").trim();
  return raw.slice(0, 48) || "dev";
}

function nowMs(): number {
  return Date.now();
}

function store(): LogControlStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: LogControlStore };
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { configByScope: {}, audits: [], events: [] };
  }
  return g[STORE_KEY] as LogControlStore;
}

function normalizeSampleRate(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(4));
}

function sanitizeReason(reason: string): string {
  const out = String(reason || "").trim();
  return out.slice(0, 240);
}

function isExpired(config: LogSwitchConfig, tsMs: number): boolean {
  return typeof config.expiresAtMs === "number" && tsMs >= config.expiresAtMs;
}

function defaultConfig(scope: LogScope): LogSwitchConfig {
  return {
    scope,
    enabled: false,
    env: appEnv(),
    minLevel: "info",
    sampleRate: 1,
    expiresAtMs: null,
    updatedAtMs: nowMs(),
    updatedBy: "system",
    reason: "default"
  };
}

export function getLogSwitchConfig(scope: LogScope): LogSwitchConfig {
  const s = store();
  const current = s.configByScope[scope];
  if (!current) return defaultConfig(scope);
  if (current.enabled && isExpired(current, nowMs())) {
    const disabled: LogSwitchConfig = {
      ...current,
      enabled: false,
      expiresAtMs: null,
      updatedAtMs: nowMs(),
      updatedBy: "system:auto-expire",
      reason: "ttl_expired_auto_disable"
    };
    s.configByScope[scope] = disabled;
    return disabled;
  }
  return current;
}

export function listLogSwitchAudits(scope?: LogScope): LogSwitchAuditEntry[] {
  const items = store().audits;
  if (!scope) return [...items];
  return items.filter((x) => x.scope === scope);
}

export function updateLogSwitchConfig(params: {
  scope: LogScope;
  enabled: boolean;
  ttlMinutes: number | null;
  minLevel?: LogLevel;
  sampleRate?: number;
  reason?: string;
  operator: string;
}): LogSwitchConfig {
  const s = store();
  const prev = getLogSwitchConfig(params.scope);
  const ts = nowMs();
  const ttlMinutes = params.ttlMinutes && params.ttlMinutes > 0 ? Math.floor(params.ttlMinutes) : null;
  const expiresAtMs = params.enabled && ttlMinutes ? ts + ttlMinutes * 60_000 : null;
  const next: LogSwitchConfig = {
    scope: params.scope,
    enabled: params.enabled,
    env: appEnv(),
    minLevel: params.minLevel || prev.minLevel || "info",
    sampleRate: normalizeSampleRate(params.sampleRate),
    expiresAtMs,
    updatedAtMs: ts,
    updatedBy: params.operator.trim() || "admin",
    reason: sanitizeReason(params.reason || "")
  };
  s.configByScope[params.scope] = next;
  const audit: LogSwitchAuditEntry = {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    scope: params.scope,
    action: next.enabled ? "enable" : "disable",
    env: next.env,
    minLevel: next.minLevel,
    sampleRate: next.sampleRate,
    ttlMinutes,
    reason: next.reason,
    operator: next.updatedBy,
    atMs: ts
  };
  s.audits = [audit, ...s.audits].slice(0, MAX_AUDIT_RECORDS);
  return next;
}

function fnv1aHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

export function shouldIngestForScope(scope: LogScope, requestId: string): boolean {
  const cfg = getLogSwitchConfig(scope);
  if (!cfg.enabled) return false;
  const p = normalizeSampleRate(cfg.sampleRate);
  if (p <= 0) return false;
  if (p >= 1) return true;
  const normalizedId = String(requestId || "");
  const bucket = fnv1aHash(normalizedId) % 10_000;
  return bucket < Math.floor(p * 10_000);
}

export function appendLogEvent(params: {
  scope: LogScope;
  requestId: string;
  traceId?: string;
  level: "info" | "error";
  errorCode: string;
  module?: string;
  route?: string;
  release?: string;
  message: string;
  location?: string;
  payload?: Record<string, unknown>;
}): void {
  const ts = nowMs();
  const errorCode = String(params.errorCode || "").trim().slice(0, 120) || "UNKNOWN_ERROR";
  const entry: LogEventEntry = {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    scope: params.scope,
    requestId: String(params.requestId || "").slice(0, 120),
    traceId: String(params.traceId || "").slice(0, 120),
    errorCode,
    level: params.level,
    env: appEnv(),
    release: String(params.release || "").trim().slice(0, 48) || appRelease(),
    module: String(params.module || "web").trim().slice(0, 120) || "web",
    route: String(params.route || "").trim().slice(0, 240),
    message: String(params.message || "").slice(0, 1200),
    location: params.location ? String(params.location).slice(0, 240) : undefined,
    payload: params.payload && typeof params.payload === "object" ? params.payload : {},
    atMs: ts
  };
  const s = store();
  s.events = [entry, ...s.events].slice(0, MAX_EVENT_RECORDS);
}

export function listLogEvents(scope: LogScope, limit: number, filters?: LogEventFilters): LogEventEntry[] {
  const n = Math.max(1, Math.min(200, Math.floor(limit || 50)));
  const all = store().events.filter((x) => {
    if (x.scope !== scope) return false;
    if (filters?.level && x.level !== filters.level) return false;
    if (filters?.requestId && !x.requestId.includes(filters.requestId)) return false;
    if (filters?.errorCode && !x.errorCode.toLowerCase().includes(filters.errorCode.toLowerCase())) return false;
    if (typeof filters?.fromMs === "number" && x.atMs < filters.fromMs) return false;
    if (typeof filters?.toMs === "number" && x.atMs > filters.toMs) return false;
    return true;
  });
  return all.slice(0, n);
}

export function topErrorClusters(scope: LogScope, windowMs: number, maxItems: number): LogErrorCluster[] {
  const now = nowMs();
  const start = now - Math.max(60_000, windowMs);
  const grouped = new Map<string, LogErrorCluster>();
  for (const item of store().events) {
    if (item.scope !== scope) continue;
    if (item.atMs < start) continue;
    const key = `${item.errorCode}|${item.route}|${item.module}|${item.level}`;
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, {
        key,
        errorCode: item.errorCode,
        route: item.route || "/",
        module: item.module || "web",
        level: item.level,
        count: 1,
        latestAtMs: item.atMs
      });
      continue;
    }
    prev.count += 1;
    if (item.atMs > prev.latestAtMs) prev.latestAtMs = item.atMs;
  }
  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.latestAtMs - a.latestAtMs)
    .slice(0, Math.max(1, Math.min(20, maxItems)));
}
