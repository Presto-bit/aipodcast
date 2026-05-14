import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export type ShownotesStudioHistoryItem = {
  id: string;
  savedAt: string;
  titles: string[];
  selectedTitleIndex: number;
  showNotes: string;
};

const MAX_ITEMS = 40;

function histKey(projectId: string): string {
  return `fym-shownotes-hist-${encodeURIComponent(projectId)}`;
}

export function loadShownotesStudioHistory(projectId: string): ShownotesStudioHistoryItem[] {
  const raw = readLocalStorageScoped(histKey(projectId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object")
      .map((x) => x as ShownotesStudioHistoryItem)
      .filter((x) => typeof x.id === "string" && typeof x.showNotes === "string");
  } catch {
    return [];
  }
}

export function saveShownotesStudioHistory(projectId: string, items: ShownotesStudioHistoryItem[]): void {
  const trimmed = items.slice(0, MAX_ITEMS);
  try {
    writeLocalStorageScoped(histKey(projectId), JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

export function clearShownotesStudioDraft(projectId: string): void {
  try {
    writeLocalStorageScoped(draftKey(projectId), "");
  } catch {
    /* ignore */
  }
}

export type ShownotesStudioDraft = {
  updatedAt: string;
  showNotes: string;
  titles: string[];
  selectedTitleIndex: number;
};

function draftKey(projectId: string): string {
  return `fym-shownotes-draft-${encodeURIComponent(projectId)}`;
}

export function loadShownotesStudioDraft(projectId: string): ShownotesStudioDraft | null {
  const raw = readLocalStorageScoped(draftKey(projectId));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const d = o as Partial<ShownotesStudioDraft>;
    if (typeof d.updatedAt !== "string" || typeof d.showNotes !== "string") return null;
    const titles = Array.isArray(d.titles) ? d.titles.map((x) => String(x || "")) : [];
    const selectedTitleIndex = Math.max(0, Math.min(4, Number(d.selectedTitleIndex) || 0));
    return { updatedAt: d.updatedAt, showNotes: d.showNotes, titles, selectedTitleIndex };
  } catch {
    return null;
  }
}

export function saveShownotesStudioDraft(projectId: string, draft: Omit<ShownotesStudioDraft, "updatedAt">): void {
  const row: ShownotesStudioDraft = {
    updatedAt: new Date().toISOString(),
    showNotes: String(draft.showNotes || ""),
    titles: Array.isArray(draft.titles) ? draft.titles.slice(0, 5) : [],
    selectedTitleIndex: Math.max(0, Math.min(4, Number(draft.selectedTitleIndex) || 0))
  };
  try {
    writeLocalStorageScoped(draftKey(projectId), JSON.stringify(row));
  } catch {
    /* quota */
  }
}

export function appendShownotesStudioHistory(
  projectId: string,
  entry: Omit<ShownotesStudioHistoryItem, "id" | "savedAt"> & { id?: string }
): ShownotesStudioHistoryItem[] {
  const id = entry.id || `h_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const row: ShownotesStudioHistoryItem = {
    id,
    savedAt: new Date().toISOString(),
    titles: Array.isArray(entry.titles) ? entry.titles.slice(0, 5) : [],
    selectedTitleIndex: Math.max(0, Math.min(2, Number(entry.selectedTitleIndex) || 0)),
    showNotes: String(entry.showNotes || "")
  };
  const prev = loadShownotesStudioHistory(projectId);
  const next = [row, ...prev.filter((x) => x.id !== id)].slice(0, MAX_ITEMS);
  saveShownotesStudioHistory(projectId, next);
  return next;
}
