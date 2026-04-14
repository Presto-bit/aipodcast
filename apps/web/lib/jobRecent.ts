/** 本机「最近创建」任务 ID（按账号隔离） */

import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

const KEY = "fym_recent_job_ids_v1";

export function rememberJobId(id: string) {
  const s = (id || "").trim();
  if (!s) return;
  try {
    const raw = readLocalStorageScoped(KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    const next = [s, ...arr.filter((x) => x !== s)].slice(0, 40);
    writeLocalStorageScoped(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function listRememberedJobIds(): string[] {
  try {
    const raw = readLocalStorageScoped(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}
