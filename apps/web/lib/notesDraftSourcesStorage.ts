/**
 * 知识库工作台「来源」勾选：按笔记本记住上次选中的资料 id（localStorage，账号隔离）。
 */
import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

const STORAGE_KEY = "notes:draft-source-ids:v1";

type NotebookToIds = Record<string, unknown>;

function parseMap(raw: string | null): NotebookToIds {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as NotebookToIds;
  } catch {
    // ignore
  }
  return {};
}

/** 读取某笔记本下上次勾选的资料 id（已按套餐上限截断） */
export function readDraftSourceIdsForNotebook(notebook: string, cap: number): string[] {
  const nb = notebook.trim();
  if (!nb || cap <= 0) return [];
  const arr = parseMap(readLocalStorageScoped(STORAGE_KEY))[nb];
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
}

/** 写入当前笔记本下的勾选（覆盖该键；其它笔记本条目保留） */
export function writeDraftSourceIdsForNotebook(notebook: string, ids: string[], cap: number): void {
  const nb = notebook.trim();
  if (!nb || cap <= 0) return;
  try {
    const map = parseMap(readLocalStorageScoped(STORAGE_KEY));
    const capped = ids
      .filter((x) => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, cap);
    map[nb] = capped;
    writeLocalStorageScoped(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota
  }
}
