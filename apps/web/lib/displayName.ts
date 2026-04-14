/** localStorage 展示名键（与设置页、侧栏共用，按账号隔离） */

import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export const DISPLAY_NAME_KEY = "minimax_aipodcast_display_name";

export const DISPLAY_NAME_EVENT = "fym_display_name_changed";

export function readStoredDisplayName(): string {
  try {
    const v = (readLocalStorageScoped(DISPLAY_NAME_KEY) || "").trim();
    return v || "访客";
  } catch {
    return "访客";
  }
}

export function saveDisplayName(name: string): string {
  const v = (name || "").trim() || "访客";
  try {
    writeLocalStorageScoped(DISPLAY_NAME_KEY, v);
    window.dispatchEvent(new Event(DISPLAY_NAME_EVENT));
  } catch {
    // ignore
  }
  return v;
}
