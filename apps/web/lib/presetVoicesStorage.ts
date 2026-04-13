import { scheduleCloudPreferencesPush } from "./cloudPreferences";

const ENABLED_PRESET_VOICES_KEY = "minimax_aipodcast_enabled_preset_voices";
export const SPEAKER_DEFAULT_VOICE_KEYS_KEY = "minimax_aipodcast_speaker_default_voice_keys";
const SPEAKER_CLONED_VOICE_IDS_KEY = "minimax_aipodcast_speaker_cloned_voice_ids";

function dispatchChanged() {
  try {
    window.dispatchEvent(new Event("minimax-preset-voices-changed"));
  } catch {
    // ignore
  }
}

export function readEnabledPresetKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(ENABLED_PRESET_VOICES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((k: unknown) => String(k || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function addEnabledPresetKey(key: string) {
  const k = String(key || "").trim();
  if (!k || k === "mini" || k === "max") return;
  const cur = new Set(readEnabledPresetKeys());
  if (cur.has(k)) return;
  cur.add(k);
  try {
    window.localStorage.setItem(ENABLED_PRESET_VOICES_KEY, JSON.stringify([...cur]));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
  dispatchChanged();
}

export function readSpeakerDefaultVoiceKeys() {
  try {
    const raw = window.localStorage.getItem(SPEAKER_DEFAULT_VOICE_KEYS_KEY);
    const d = raw ? JSON.parse(raw) : {};
    return {
      speaker1: typeof d.speaker1 === "string" && d.speaker1.trim() ? d.speaker1.trim() : "mini",
      speaker2: typeof d.speaker2 === "string" && d.speaker2.trim() ? d.speaker2.trim() : "max"
    };
  } catch {
    return { speaker1: "mini", speaker2: "max" };
  }
}

export function writeSpeakerDefaultVoiceKeys(speaker1: string, speaker2: string) {
  const n1 = speaker1 || "mini";
  const n2 = speaker2 || "max";
  const cur = readSpeakerDefaultVoiceKeys();
  if (cur.speaker1 === n1 && cur.speaker2 === n2) return;
  try {
    window.localStorage.setItem(SPEAKER_DEFAULT_VOICE_KEYS_KEY, JSON.stringify({ speaker1: n1, speaker2: n2 }));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
  dispatchChanged();
}

export function readSpeakerClonedVoiceIds() {
  try {
    const raw = window.localStorage.getItem(SPEAKER_CLONED_VOICE_IDS_KEY);
    const d = raw ? JSON.parse(raw) : {};
    const norm = (x: unknown) => {
      if (typeof x !== "string") return null;
      const t = x.trim();
      return t ? t : null;
    };
    return {
      speaker1: norm(d.speaker1),
      speaker2: norm(d.speaker2)
    };
  } catch {
    return { speaker1: null as string | null, speaker2: null as string | null };
  }
}

export function writeSpeakerClonedVoiceIds(speaker1Id: string | null, speaker2Id: string | null) {
  const n1 = speaker1Id && String(speaker1Id).trim() ? String(speaker1Id).trim() : null;
  const n2 = speaker2Id && String(speaker2Id).trim() ? String(speaker2Id).trim() : null;
  const cur = readSpeakerClonedVoiceIds();
  if (cur.speaker1 === n1 && cur.speaker2 === n2) return;
  try {
    window.localStorage.setItem(SPEAKER_CLONED_VOICE_IDS_KEY, JSON.stringify({ speaker1: n1, speaker2: n2 }));
    scheduleCloudPreferencesPush();
  } catch {
    // ignore
  }
  dispatchChanged();
}

export function assignPresetToSpeaker(which: "speaker1" | "speaker2", voiceKey: string) {
  const k = String(voiceKey || "").trim();
  if (!k) return;
  addEnabledPresetKey(k);
  const cur = readSpeakerDefaultVoiceKeys();
  const curC = readSpeakerClonedVoiceIds();
  if (which === "speaker1") {
    writeSpeakerClonedVoiceIds(null, curC.speaker2);
    writeSpeakerDefaultVoiceKeys(k, cur.speaker2);
  } else if (which === "speaker2") {
    writeSpeakerClonedVoiceIds(curC.speaker1, null);
    writeSpeakerDefaultVoiceKeys(cur.speaker1, k);
  }
}

export function assignClonedVoiceToSpeaker(which: "speaker1" | "speaker2", voiceId: string) {
  const id = String(voiceId || "").trim();
  if (!id) return;
  const curC = readSpeakerClonedVoiceIds();
  if (which === "speaker1") {
    writeSpeakerClonedVoiceIds(id, curC.speaker2);
  } else if (which === "speaker2") {
    writeSpeakerClonedVoiceIds(curC.speaker1, id);
  }
}
