/** 笔记工作台：记住用户上次选中的笔记本（localStorage） */
export const NOTES_LAST_NOTEBOOK_KEY = "notes:last-notebook:v1";

export const NOTES_NAV_WORKBENCH_EVENT = "fym:notes-open-workbench";

export function readLastNotebookName(): string {
  try {
    return String(window.localStorage.getItem(NOTES_LAST_NOTEBOOK_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeLastNotebookName(name: string): void {
  const n = String(name || "").trim();
  if (!n) return;
  try {
    window.localStorage.setItem(NOTES_LAST_NOTEBOOK_KEY, n);
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
