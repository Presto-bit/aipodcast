/**
 * 知识库「笔记本分享」失败诊断：与 `app/notes/page.tsx` 共用 localStorage 键，
 * 供首页等其它页面展示同一份日志。
 */

import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export const NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY = "notes:share-last-error:v1";
export const NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY_FALLBACK = "notes:share-last-error:fallback:v1";
export const NOTEBOOK_SHARE_FAILURE_HISTORY_STORAGE_KEY = "notes:share-failure-history:v1";

export const NOTEBOOK_SHARE_DIAGNOSTICS_UPDATED_EVENT = "fym-notebook-share-diagnostics-updated";

const DEBUG_INGEST = "http://127.0.0.1:7784/ingest/19ebcc68-23a5-4b58-8422-e77d07554c98";
const DEBUG_SESSION = "f9896b";

export type AgentDebugLogOptions = {
  /**
   * 为 true 时在生产环境向 `/api/notebook-share-client-diagnostics` 上报一行结构化日志，
   * 便于在托管平台日志中检索 `notebook_share_client`（需已登录，携带会话 Cookie）。
   * 勿在高频路径（如每次读 localStorage）开启，以免刷屏与噪音。
   */
  serverReport?: boolean;
};

/** 双写：ingest + 开发环境同源落盘；可选生产上报（见 `serverReport`）。 */
export function agentDebugLog(payload: Record<string, unknown>, opts?: AgentDebugLogOptions): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    sessionId: DEBUG_SESSION,
    route: window.location.pathname,
    release:
      (typeof process !== "undefined" &&
        process.env &&
        (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_VERSION)) ||
      "web-dev",
    ...payload,
    timestamp: Date.now()
  });
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION },
    body
  }).catch(() => {});
  if (process.env.NODE_ENV !== "production") {
    fetch("/api/debug-agent-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    }).catch(() => {});
  }
  if (opts?.serverReport === true && process.env.NODE_ENV === "production") {
    fetch("/api/notebook-share-client-diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body
    }).catch(() => {});
  }
}

export type ShareLastErrorPayload = {
  debugLog: string;
  error: string;
  notebook: string;
  at: string;
};

export type ShareFailureEntry = {
  id: string;
  mode: "share" | "unshare";
  notebook: string;
  error: string;
  at: string;
  debugLog: string;
};

function tryParseLast(raw: string | null): ShareLastErrorPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const debugLog = typeof parsed.debugLog === "string" ? parsed.debugLog : "";
    if (!debugLog.trim()) return null;
    return {
      debugLog,
      error: typeof parsed.error === "string" ? parsed.error : "",
      notebook: typeof parsed.notebook === "string" ? parsed.notebook : "",
      at: typeof parsed.at === "string" ? parsed.at : ""
    };
  } catch {
    return null;
  }
}

/** 读取最近一次分享失败快照（scoped 优先，其次全局 fallback）。 */
export function readNotebookShareLastError(): ShareLastErrorPayload | null {
  if (typeof window === "undefined") return null;
  const scopedRaw = readLocalStorageScoped(NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY);
  const scoped = tryParseLast(scopedRaw);
  const fallback = tryParseLast(window.localStorage.getItem(NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY_FALLBACK));
  const out = scoped || fallback;
  agentDebugLog({
    hypothesisId: "H3",
    location: "notebookShareDiagnostics.ts:readNotebookShareLastError",
    message: "read last share error",
    data: {
      scopedRawLen: scopedRaw ? scopedRaw.length : 0,
      hasScoped: Boolean(scoped),
      hasFallback: Boolean(fallback),
      hasOut: Boolean(out)
    }
  });
  if (scoped) return scoped;
  return fallback;
}

/** 读取分享失败历史（非 scoped，与笔记页一致）。 */
export function readNotebookShareFailureHistory(): ShareFailureEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_SHARE_FAILURE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : "";
        const mode = r.mode === "unshare" ? "unshare" : "share";
        const notebook = typeof r.notebook === "string" ? r.notebook : "";
        const error = typeof r.error === "string" ? r.error : "";
        const at = typeof r.at === "string" ? r.at : "";
        const debugLog = typeof r.debugLog === "string" ? r.debugLog : "";
        if (!id || !debugLog) return null;
        return { id, mode, notebook, error, at, debugLog };
      })
      .filter((x): x is ShareFailureEntry => Boolean(x))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function clearNotebookShareLastErrorStorage(): void {
  try {
    writeLocalStorageScoped(NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY, "");
  } catch {
    // ignore
  }
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY_FALLBACK);
    }
  } catch {
    // ignore
  }
}

export function clearNotebookShareFailureHistoryStorage(): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(NOTEBOOK_SHARE_FAILURE_HISTORY_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function notifyNotebookShareDiagnosticsUpdated(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(NOTEBOOK_SHARE_DIAGNOSTICS_UPDATED_EVENT));
  } catch {
    // ignore
  }
}
