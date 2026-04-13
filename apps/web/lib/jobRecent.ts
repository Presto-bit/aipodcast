/** 本机「最近创建」任务 ID（服务端列表可能尚未出现 running 条目时便于跳转详情） */

const KEY = "fym_recent_job_ids_v1";

export function rememberJobId(id: string) {
  const s = (id || "").trim();
  if (!s) return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    const next = [s, ...arr.filter((x) => x !== s)].slice(0, 40);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function listRememberedJobIds(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}
