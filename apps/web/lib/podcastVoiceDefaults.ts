/**
 * 与 legacy_backend/config.py 中 DEFAULT_VOICES 的 mini / max 保持一致。
 * 当 /api/default-voices 尚未返回或失败时，仍用于展示与提交 voice_id，避免误用 male-qn-qingse。
 */
export const PODCAST_PRESET_VOICES: Record<string, Record<string, unknown>> = {
  mini: {
    voice_id: "moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d",
    name: "Mini",
    description: "女声 - 活泼亲切"
  },
  max: {
    voice_id: "moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85",
    name: "Max",
    description: "男声 - 稳重专业"
  }
};

/** 任意音色 key 无法解析时的兜底 ID（与 DEFAULT_VOICES.mini），禁止回退到 male-qn-qingse。 */
export const PODCAST_DEFAULT_VOICE_ID_FALLBACK = String(
  PODCAST_PRESET_VOICES.mini?.voice_id ?? "moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d"
);
