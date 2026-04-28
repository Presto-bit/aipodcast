/**
 * 知识库「笔记本分享」失败诊断：与 `app/notes/page.tsx` 共用 localStorage 键，
 * 供首页等其它页面展示同一份日志。
 */

import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export const NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY = "notes:share-last-error:v1";
export const NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY_FALLBACK = "notes:share-last-error:fallback:v1";
export const NOTEBOOK_SHARE_FAILURE_HISTORY_STORAGE_KEY = "notes:share-failure-history:v1";

export const NOTEBOOK_SHARE_DIAGNOSTICS_UPDATED_EVENT = "fym-notebook-share-diagnostics-updated";

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
  const scoped = tryParseLast(readLocalStorageScoped(NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY));
  if (scoped) return scoped;
  return tryParseLast(window.localStorage.getItem(NOTEBOOK_SHARE_LAST_ERROR_STORAGE_KEY_FALLBACK));
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
