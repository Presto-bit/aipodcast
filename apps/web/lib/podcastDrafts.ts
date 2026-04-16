/**
 * 播客草稿箱（与 `/drafts` 页共用 localStorage 结构）
 */
import { readLocalStorageScoped, writeLocalStorageScoped, writeSessionStorageScoped } from "./userScopedStorage";

export const PODCAST_DRAFTS_STORAGE_KEY = "fym_podcast_drafts_v1";

/** 从作品「修改文稿」跳转后，草稿箱应选中的草稿 id（读一次后由页面清除） */
export const DRAFTS_NAV_FOCUS_DRAFT_ID_KEY = "fym_drafts_nav_focus_draft_v1";

export type PodcastDraft = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export function loadPodcastDrafts(): PodcastDraft[] {
  try {
    const raw = readLocalStorageScoped(PODCAST_DRAFTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePodcastDrafts(list: PodcastDraft[]): void {
  try {
    writeLocalStorageScoped(PODCAST_DRAFTS_STORAGE_KEY, JSON.stringify((list || []).slice(0, 100)));
  } catch {
    // quota
  }
}

/**
 * 在列表顶部插入一条草稿并持久化，返回新草稿 id。
 */
export function insertPodcastDraftAtTop(opts: { title: string; text: string }): string {
  const id = `${Date.now()}`;
  const t = new Date().toISOString();
  const entry: PodcastDraft = {
    id,
    title: String(opts.title || "").trim() || "未命名草稿",
    text: String(opts.text || ""),
    createdAt: t,
    updatedAt: t
  };
  const prev = loadPodcastDrafts();
  const next = [entry, ...prev].slice(0, 100);
  savePodcastDrafts(next);
  return id;
}

export function setDraftsNavigationFocusDraftId(draftId: string): void {
  writeSessionStorageScoped(DRAFTS_NAV_FOCUS_DRAFT_ID_KEY, String(draftId || "").trim());
}
