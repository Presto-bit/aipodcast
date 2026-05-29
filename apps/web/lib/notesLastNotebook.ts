/** 笔记工作台：记住用户上次选中的笔记本（localStorage，按账号隔离） */
import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export const NOTES_LAST_NOTEBOOK_KEY = "notes:last-notebook:v1";

/** 侧栏再次点「知识库」且已在 /notes 时：回到笔记本卡片列表，不自动进入工作台 */
export const NOTES_NAV_HUB_EVENT = "fym:notes-show-notebook-hub";

/** 离开知识库或点击主导航时：关闭笔记本内全屏弹层（添加资料、播客房间等） */
export const NOTES_DISMISS_OVERLAYS_EVENT = "fym:notes-dismiss-overlays";

export const NOTES_NAV_WORKBENCH_EVENT = "fym:notes-open-workbench";

export function readLastNotebookName(): string {
  try {
    return String(readLocalStorageScoped(NOTES_LAST_NOTEBOOK_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeLastNotebookName(name: string): void {
  const n = String(name || "").trim();
  if (!n) return;
  try {
    writeLocalStorageScoped(NOTES_LAST_NOTEBOOK_KEY, n);
  } catch {
    // ignore
  }
}

export function pickNotebookForWorkbench(notebooks: string[]): string {
  if (notebooks.length === 0) return "";
  const last = readLastNotebookName();
  if (last && notebooks.includes(last)) return last;
  return notebooks[0] ?? "";
}

export function dispatchNotesOpenWorkbench(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_NAV_WORKBENCH_EVENT, { bubbles: false }));
}

export function dispatchNotesShowNotebookHub(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_NAV_HUB_EVENT, { bubbles: false }));
}

export function dispatchNotesDismissOverlays(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_DISMISS_OVERLAYS_EVENT, { bubbles: false }));
}

/** 知识库已进入具体笔记本工作台：主导航收起，由 AppShell 在左侧居中展示返回导航入口 */
export const NOTES_MINIMAL_MAIN_NAV_EVENT = "fym:notes-minimal-main-nav";

export function dispatchNotesMinimalMainNav(minimal: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_MINIMAL_MAIN_NAV_EVENT, { detail: { minimal }, bubbles: false }));
}
