/**
 * Studio Works 云端同步（user_preferences 白名单键 fym_studio_works_v1）
 */

import { scheduleCloudPreferencesPush } from "./cloudPreferences";
import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";
import { migrateStudioWorkToV3 } from "./studioWorkMigrate";
import type { StudioWork } from "./studioWorkTypes";

export const STUDIO_WORKS_STORAGE_KEY = "fym_studio_works_v1";

function normalizeStudioWork(w: StudioWork): StudioWork {
  const base = migrateStudioWorkToV3({
    ...w,
    agentTurns: Array.isArray(w.agentTurns) ? w.agentTurns : [],
    agentSessionState: w.agentSessionState ?? null,
    allowModelFallback: w.allowModelFallback !== false
  });
  return base;
}

export function readStudioWorksBlob(): StudioWork[] {
  const raw = readLocalStorageScoped(STUDIO_WORKS_STORAGE_KEY);
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as StudioWork[];
    return Array.isArray(parsed) ? parsed.map(normalizeStudioWork) : [];
  } catch {
    return [];
  }
}

export function writeStudioWorksBlob(works: StudioWork[]): void {
  writeLocalStorageScoped(STUDIO_WORKS_STORAGE_KEY, JSON.stringify(works));
  scheduleCloudPreferencesPush();
}
