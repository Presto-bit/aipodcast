import { scheduleCloudPreferencesPush } from "./cloudPreferences";

const FAVORITE_VOICE_IDS_KEY = "fym_favorite_voice_ids_v1";
const MAX_FAVORITES = 200;

function dispatchFavoriteChanged() {
  try {
    window.dispatchEvent(new Event("fym-favorite-voices-changed"));
  } catch {
    // ignore
  }
}

export function readFavoriteVoiceIds(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITE_VOICE_IDS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of arr) {
      const id = String(x || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

export function isFavoriteVoiceId(voiceId: string): boolean {
  const id = String(voiceId || "").trim();
  if (!id) return false;
  return readFavoriteVoiceIds().includes(id);
}

/** @returns 收藏后是否为已收藏（true=已收藏，false=已取消） */
export function toggleFavoriteVoiceId(voiceId: string): boolean {
  const id = String(voiceId || "").trim();
  if (!id) return false;
  const cur = readFavoriteVoiceIds();
  const idx = cur.indexOf(id);
  let next: string[];
  if (idx >= 0) {
    next = cur.filter((x) => x !== id);
  } else {
    next = [...cur.filter((x) => x !== id), id];
    if (next.length > MAX_FAVORITES) {
      next = next.slice(next.length - MAX_FAVORITES);
    }
  }
  try {
    window.localStorage.setItem(FAVORITE_VOICE_IDS_KEY, JSON.stringify(next));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
  dispatchFavoriteChanged();
  return idx < 0;
}
