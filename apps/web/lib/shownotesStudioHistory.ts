import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

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
