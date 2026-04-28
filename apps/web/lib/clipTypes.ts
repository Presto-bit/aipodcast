export type ClipMergeLimits = {
  max_duration_sec: number;
  max_total_bytes: number;
  max_total_bytes_mb: number;
  max_duration_h: number;
};

/** 多段暂存（与编排器 audio_staging_keys 元素一致） */
export type ClipAudioStagingEntry = {
  key: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
};

/** 静音分析缓存（与编排器 silence_analysis 一致） */
export type ClipSilenceAnalysis = {
  object_key?: string;
  segments?: ClipSilenceSegment[];
};

export type ClipSilenceSegment = {
  start_ms: number;
  end_ms: number;
};

/** 精剪时间线（编排器 timeline_json / timeline_effective） */
export type ClipTimelineClip = {
  id?: string;
  start_ms: number;
  end_ms: number;
  source?: string;
  word_ids?: string[];
};

export type ClipTimelineTrack = {
  id: string;
  kind?: string;
  label?: string;
  clips?: ClipTimelineClip[];
};

export type ClipTimelineDoc = {
  version?: number;
  tracks?: ClipTimelineTrack[];
  silence_cuts?: { start_ms: number; end_ms: number; cap_ms?: number | null }[];
  audio_events?: {
    id?: string;
    start_ms: number;
    end_ms: number;
    label: "music" | "noise" | "laughter" | "applause" | string;
    confidence?: number | null;
    action?: "keep" | "cut" | "duck" | string;
  }[];
};

export type ClipStudioSnapshot = {
  id?: string;
  label?: string;
  created_at?: string;
  excluded_word_ids?: string[];
  timeline_json?: ClipTimelineDoc | null;
};

export type ClipCollaborationNote = {
  id?: string;
  author?: string;
  body: string;
  word_id?: string;
  at_ms?: number;
};

export type ClipRetakeTake = {
  object_key: string;
  filename?: string;
  created_at?: string;
  duration_ms?: number | null;
};

export type ClipRetakeSlot = {
  id: string;
  after_word_id: string;
  label?: string;
  status?: string;
  takes?: ClipRetakeTake[];
  active_take_index?: number;
};

export type ClipQcReport = {
  analyzed_at?: string;
  loudness?: Record<string, unknown>;
  silence_segments_count?: number;
  silence_long_ge_2p5s?: number;
  silence_max_gap_ms?: number;
  hints?: string[];
};

/** 导出时压缩超长词间静音（粗剪）；由 PATCH export_pause_policy 写入 */
export type ClipExportPausePolicy = {
  enabled: boolean;
  long_gap_ms: number;
  cap_ms: number;
};

export type ClipProjectRow = {
  id: string;
  title: string;
  transcription_status: string;
  export_status: string;
  export_pause_policy?: ClipExportPausePolicy | null;
  /** 修音 / 导出 loudnorm 整合响度 I（LUFS）；null 表示用 CLIP_EXPORT_LOUDNORM_I 或默认 -16 */
  repair_loudness_i_lufs?: number | null;
  /** 嘉宾名 / 公司名 / 专业词：整词匹配时不做口癖高亮与规则建议 */
  rough_cut_lexicon_exempt?: string[];
  /** 火山 ASR 热词（corpus.context hotwords），转写 submit 时传入 */
  asr_corpus_hotwords?: string[];
  /** 火山 ASR 场景/上下文（dialog_ctx），转写 submit 时传入 */
  asr_corpus_scene?: string | null;
  has_audio?: boolean;
  audio_staging_count?: number;
  audio_staging_keys?: ClipAudioStagingEntry[];
  clip_merge_limits?: ClipMergeLimits;
  clip_asr_provider?: string;
  created_at?: string;
  updated_at?: string;
  audio_filename?: string | null;
  transcription_error?: string | null;
  export_error?: string | null;
  transcript_normalized?: { version?: number; words?: ClipWord[]; duration_ms?: number } | null;
  excluded_word_ids?: string[];
  /** 建议执行/撤销等事件日志，供 LLM 反哺 */
  suggestion_feedback?: unknown[] | null;
  /** ffmpeg silencedetect 缓存 */
  silence_analysis?: ClipSilenceAnalysis | null;
  timeline_json?: ClipTimelineDoc | null;
  studio_snapshots?: ClipStudioSnapshot[] | null;
  collaboration_notes?: ClipCollaborationNote[] | null;
  retake_manifest?: ClipRetakeSlot[] | null;
  qc_report?: ClipQcReport | null;
  audio_download_url?: string | null;
  export_download_url?: string | null;
  diarization_enabled?: boolean;
  speaker_count?: number;
  channel_ids?: number[];
};

export type ClipWord = {
  id: string;
  speaker: number;
  text: string;
  s_ms: number;
  e_ms: number;
  punct?: string;
  /** ASR utterance 新条首词（服务端归一化写入）；用于稿面换行 */
  utt_new?: boolean;
};
