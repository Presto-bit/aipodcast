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

type LogControlStore = {
  configByScope: Partial<Record<LogScope, LogSwitchConfig>>;
  audits: LogSwitchAuditEntry[];
};

const STORE_KEY = "__fymLogControlStore";
const MAX_AUDIT_RECORDS = 120;

function appEnv(): string {
  const raw = String(process.env.APP_ENV || process.env.NODE_ENV || "development").trim().toLowerCase();
  if (!raw) return "development";
  return raw;
}

function nowMs(): number {
  return Date.now();
}

function store(): LogControlStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: LogControlStore };
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { configByScope: {}, audits: [] };
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
