/**
 * 预设默认音色：仅 mini/max 始终可选；其余需「使用」后加入列表。
 * 说话人当前选用的预设键单独持久化，与音色管理「使用」同步。
 */

export const ENABLED_PRESET_VOICES_KEY = 'minimax_aipodcast_enabled_preset_voices';
export const SPEAKER_DEFAULT_VOICE_KEYS_KEY = 'minimax_aipodcast_speaker_default_voice_keys';
/** 非空 string 表示该说话人使用已克隆音色；null 表示使用「默认预设」下拉 */
export const SPEAKER_CLONED_VOICE_IDS_KEY = 'minimax_aipodcast_speaker_cloned_voice_ids';
export const PRESET_VOICES_CHANGED_EVENT = 'minimax-preset-voices-changed';

function dispatchChanged() {
  try {
    window.dispatchEvent(new Event(PRESET_VOICES_CHANGED_EVENT));
  } catch (e) {
    // ignore
  }
}

export function readEnabledPresetKeys() {
  try {
    const raw = window.localStorage.getItem(ENABLED_PRESET_VOICES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((k) => String(k || '').trim()).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

/** 非 mini/max 的预设加入「可选列表」 */
export function addEnabledPresetKey(key) {
  const k = String(key || '').trim();
  if (!k || k === 'mini' || k === 'max') return;
  const cur = new Set(readEnabledPresetKeys());
  if (cur.has(k)) return;
  cur.add(k);
  try {
    window.localStorage.setItem(ENABLED_PRESET_VOICES_KEY, JSON.stringify([...cur]));
  } catch (e) {
    // ignore
  }
  dispatchChanged();
}

export function readSpeakerDefaultVoiceKeys() {
  try {
    const raw = window.localStorage.getItem(SPEAKER_DEFAULT_VOICE_KEYS_KEY);
    const d = raw ? JSON.parse(raw) : {};
    return {
      speaker1: typeof d.speaker1 === 'string' && d.speaker1.trim() ? d.speaker1.trim() : 'mini',
      speaker2: typeof d.speaker2 === 'string' && d.speaker2.trim() ? d.speaker2.trim() : 'max'
    };
  } catch (e) {
    return { speaker1: 'mini', speaker2: 'max' };
  }
}

export function writeSpeakerDefaultVoiceKeys(speaker1, speaker2) {
  const n1 = speaker1 || 'mini';
  const n2 = speaker2 || 'max';
  const cur = readSpeakerDefaultVoiceKeys();
  if (cur.speaker1 === n1 && cur.speaker2 === n2) return;
  try {
    window.localStorage.setItem(
      SPEAKER_DEFAULT_VOICE_KEYS_KEY,
      JSON.stringify({ speaker1: n1, speaker2: n2 })
    );
  } catch (e) {
    // ignore
  }
  dispatchChanged();
}

export function readSpeakerClonedVoiceIds() {
  try {
    const raw = window.localStorage.getItem(SPEAKER_CLONED_VOICE_IDS_KEY);
    const d = raw ? JSON.parse(raw) : {};
    const norm = (x) => {
      if (typeof x !== 'string') return null;
      const t = x.trim();
      return t ? t : null;
    };
    return {
      speaker1: norm(d.speaker1),
      speaker2: norm(d.speaker2)
    };
  } catch (e) {
    return { speaker1: null, speaker2: null };
  }
}

export function writeSpeakerClonedVoiceIds(speaker1Id, speaker2Id) {
  const n1 = speaker1Id && String(speaker1Id).trim() ? String(speaker1Id).trim() : null;
  const n2 = speaker2Id && String(speaker2Id).trim() ? String(speaker2Id).trim() : null;
  const cur = readSpeakerClonedVoiceIds();
  if (cur.speaker1 === n1 && cur.speaker2 === n2) return;
  try {
    window.localStorage.setItem(
      SPEAKER_CLONED_VOICE_IDS_KEY,
      JSON.stringify({ speaker1: n1, speaker2: n2 })
    );
  } catch (e) {
    // ignore
  }
  dispatchChanged();
}

/** 从音色管理：分配到 Speaker1 或 Speaker2 */
export function assignPresetToSpeaker(which, voiceKey) {
  const k = String(voiceKey || '').trim();
  if (!k) return;
  addEnabledPresetKey(k);
  const cur = readSpeakerDefaultVoiceKeys();
  const curC = readSpeakerClonedVoiceIds();
  if (which === 'speaker1') {
    writeSpeakerClonedVoiceIds(null, curC.speaker2);
    writeSpeakerDefaultVoiceKeys(k, cur.speaker2);
  } else if (which === 'speaker2') {
    writeSpeakerClonedVoiceIds(curC.speaker1, null);
    writeSpeakerDefaultVoiceKeys(cur.speaker1, k);
  }
}

/** 从音色管理：将已克隆音色分配到 Speaker1 或 Speaker2（生成页切到自定义 + 选中该 ID） */
export function assignClonedVoiceToSpeaker(which, voiceId) {
  const id = String(voiceId || '').trim();
  if (!id) return;
  const curC = readSpeakerClonedVoiceIds();
  if (which === 'speaker1') {
    writeSpeakerClonedVoiceIds(id, curC.speaker2);
  } else if (which === 'speaker2') {
    writeSpeakerClonedVoiceIds(curC.speaker1, id);
  }
}
