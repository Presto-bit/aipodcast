/**
 * 登录用户：模板/作品展示偏好等同步到服务端（与编排器 ALLOWED_USER_PREF_KEYS 白名单一致）。
 * 播客草稿仅保存在浏览器 localStorage，不参与云端同步。
 */

import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export const CLOUD_PREF_KEYS = [
  "fym_user_templates_v1",
  "fym_native_works_folders_v1",
  "fym_native_works_assign_v1",
  "fym_podcast_works_hidden_v1",
  "fym_podcast_works_display_titles_v1",
  "fym_tts_works_hidden_v1",
  "fym_tts_works_display_titles_v1",
  "fym_notes_works_hidden_v1",
  "fym_notes_works_display_titles_v1",
  "fym_notes_studio_works_hidden_v1",
  "fym_notes_studio_works_display_titles_v1",
  "minimax_aipodcast_enabled_preset_voices",
  "minimax_aipodcast_speaker_default_voice_keys",
  "minimax_aipodcast_speaker_cloned_voice_ids",
  "fym_favorite_voice_ids_v1"
] as const;

let cloudPrefsSyncEnabled = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function setCloudPrefsSyncEnabled(enabled: boolean) {
  cloudPrefsSyncEnabled = enabled;
  if (!enabled && pushTimer != null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

function prefValueIsUseful(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "object") return Object.keys(val as object).length > 0;
  if (typeof val === "number" || typeof val === "boolean") return true;
  return false;
}

function rawLocalToValue(raw: string | null): unknown {
  if (!raw || !String(raw).trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function applyRemoteToStorage(key: string, val: unknown) {
  if (val === undefined || val === null) return;
  if (typeof val === "string") {
    writeLocalStorageScoped(key, val);
    return;
  }
  try {
    writeLocalStorageScoped(key, JSON.stringify(val));
  } catch {
    // ignore
  }
}

/**
 * 登录后拉取：远端有内容则写入 localStorage；仅本地有内容则上传合并。
 */
export async function pullCloudPreferences(): Promise<void> {
  if (typeof window === "undefined" || !cloudPrefsSyncEnabled) return;
  try {
    const res = await fetch("/api/user/preferences", { credentials: "same-origin", cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Record<string, unknown> };
    if (!res.ok || !j.success || !j.data || typeof j.data !== "object") return;
    const server = j.data;
    const toUpload: Record<string, unknown> = {};
    for (const key of CLOUD_PREF_KEYS) {
      const localRaw = readLocalStorageScoped(key);
      const localVal = rawLocalToValue(localRaw);
      const remoteVal = server[key];
      const remoteOk = prefValueIsUseful(remoteVal);
      const localOk = prefValueIsUseful(localVal);
      if (remoteOk) {
        applyRemoteToStorage(key, remoteVal);
      } else if (localOk && localVal !== undefined) {
        toUpload[key] = localVal;
      }
    }
    if (Object.keys(toUpload).length > 0) {
      await fetch("/api/user/preferences", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: toUpload })
      });
    }
    try {
      window.dispatchEvent(new Event("fym-favorite-voices-changed"));
      window.dispatchEvent(new Event("minimax-preset-voices-changed"));
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

function buildLocalPatchPayload(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of CLOUD_PREF_KEYS) {
    const v = rawLocalToValue(readLocalStorageScoped(key));
    if (prefValueIsUseful(v) && v !== undefined) data[key] = v;
  }
  return data;
}

/** 本地偏好变更后防抖上行（仅已登录且已开启同步时） */
export function scheduleCloudPreferencesPush() {
  if (typeof window === "undefined" || !cloudPrefsSyncEnabled) return;
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const data = buildLocalPatchPayload();
    if (!Object.keys(data).length) return;
    void fetch("/api/user/preferences", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data })
    }).catch(() => {});
  }, 800);
}
