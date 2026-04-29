import type { JobRecord } from "./types";

const TTS_TYPES = new Set(["text_to_speech", "tts"]);

/** 「我的作品」导航页音频合并列表：一级体裁 */
export function worksNavPrimaryKind(type: string | undefined): string {
  const t = String(type || "");
  if (t === "script_draft") return "文章";
  if (TTS_TYPES.has(t)) return "文本转语音";
  return "播客";
}

export function worksNavMetricPart(
  isScriptDraft: boolean,
  durationLine: string,
  scriptCharCountDisplay: number | null
): string {
  if (isScriptDraft) {
    return scriptCharCountDisplay != null && scriptCharCountDisplay > 0
      ? `约 ${Math.round(scriptCharCountDisplay).toLocaleString()} 字`
      : "—";
  }
  return durationLine !== "—" ? `时长 ${durationLine}` : "—";
}

/** 作品列表/详情：年月日 + 24 小时制时分 */
export function formatWorkCreatedAtZh(createdAt: string | undefined | null): string {
  const raw = String(createdAt || "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function durationLineFromJobResult(result: Record<string, unknown>): string {
  const durRaw = result.audio_duration_sec;
  let dur: number | null = null;
  if (typeof durRaw === "number" && Number.isFinite(durRaw) && durRaw > 0) dur = durRaw;
  else if (typeof durRaw === "string" && String(durRaw).trim()) {
    const n = Number.parseFloat(String(durRaw));
    if (Number.isFinite(n) && n > 0) dur = n;
  }
  return dur != null ? formatClock(dur) : "—";
}

function scriptCharCountFromJob(job: JobRecord): number | null {
  const result = (job.result || {}) as Record<string, unknown>;
  const sc = result.script_char_count;
  if (sc != null) {
    try {
      const v = Number(sc);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    } catch {
      /* ignore */
    }
  }
  const st = String(result.script_text || "").trim();
  if (st) return st.length;
  return null;
}

/**
 * 与「我的作品」合并列表卡片 meta 完全一致：一级 | 作者 | 时长/字数 | 时间
 */
export function formatUnifiedWorksNavMetaLineFromJobRecord(job: JobRecord, authorDisplay: string): string {
  const result = (job.result || {}) as Record<string, unknown>;
  const isScriptDraft = String(job.job_type || "") === "script_draft";
  const primaryK = worksNavPrimaryKind(job.job_type);
  const durationLine = durationLineFromJobResult(result);
  const scriptCharCountDisplay = scriptCharCountFromJob(job);
  const metricP = worksNavMetricPart(isScriptDraft, durationLine, scriptCharCountDisplay);
  const createdZh = formatWorkCreatedAtZh(job.completed_at || job.created_at);
  return [primaryK, authorDisplay, metricP, createdZh]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" | ");
}
