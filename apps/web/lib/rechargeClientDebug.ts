/**
 * 充值 / 余额同步：浏览器端排查时间线（sessionStorage），不含 Authorization。
 * 可见与写入：开发环境默认；生产设 NEXT_PUBLIC_RECHARGE_DEBUG_UI=1 或 localStorage.recharge_debug_ui=1；
 * 或当前会话 `user.role === "admin"`（与 /api/auth/me 一致）时管理员始终可见、可累积日志。
 */

export const RECHARGE_DEBUG_EVENT = "fym-recharge-debug";

export type RechargeDebugEntry = {
  ts: string;
  step: string;
  requestId?: string;
  data?: Record<string, unknown>;
};

const STORAGE_KEY = "fym_recharge_debug_v1";
const MAX = 60;

export function newRechargeDebugRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* noop */
  }
  return `rid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function rechargeDebugEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_RECHARGE_DEBUG_UI === "1") return true;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") return true;
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage?.getItem("recharge_debug_ui") === "1") return true;
    } catch {
      /* noop */
    }
  }
  return false;
}

/** 与 AppShell /admin 一致：`/api/auth/me` 返回的 role */
export function authUserIsAdmin(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  const r = (user as { role?: unknown }).role;
  return String(r ?? "").trim() === "admin";
}

/** 订阅页「充值路径日志」展示与写入：管理员或显式调试开关 */
export function rechargePathLogVisibleForUser(user: unknown): boolean {
  if (authUserIsAdmin(user)) return true;
  return rechargeDebugEnabled();
}

function dispatch(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RECHARGE_DEBUG_EVENT));
  }
}

export function appendRechargeDebug(
  step: string,
  data?: Record<string, unknown>,
  requestId?: string,
  userForVisibility?: unknown
): void {
  if (!rechargePathLogVisibleForUser(userForVisibility)) return;
  if (typeof window === "undefined") return;
  try {
    const entry: RechargeDebugEntry = {
      ts: new Date().toISOString(),
      step,
      ...(requestId ? { requestId } : {}),
      ...(data && Object.keys(data).length ? { data } : {})
    };
    const raw = sessionStorage.getItem(STORAGE_KEY);
    let arr: RechargeDebugEntry[] = [];
    if (raw) {
      try {
        const p = JSON.parse(raw) as unknown;
        if (Array.isArray(p)) {
          arr = p.filter((x) => x && typeof x === "object") as RechargeDebugEntry[];
        }
      } catch {
        arr = [];
      }
    }
    arr.push(entry);
    while (arr.length > MAX) arr.shift();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    dispatch();
  } catch {
    /* noop */
  }
}

export function readRechargeDebug(): RechargeDebugEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as RechargeDebugEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearRechargeDebug(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    dispatch();
  } catch {
    /* noop */
  }
}

/** 仅用于日志展示，避免整段收银台 URL 占满存储 */
export function summarizePayUrl(u: string): string {
  const s = (u || "").trim();
  if (!s) return "";
  try {
    const x = new URL(s);
    const sp = x.searchParams;
    const method = sp.get("method") || "";
    return `${x.origin}${x.pathname}${method ? `?method=${method.slice(0, 40)}` : ""}`;
  } catch {
    return "(invalid_pay_url)";
  }
}
