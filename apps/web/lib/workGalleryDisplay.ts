import type { WorkItem } from "./worksTypes";
import { isTextOnlyWorkType } from "./worksTypes";
import { worksNavPrimaryKind } from "./worksNavMetaLine";

/** 全站「音频」Tab：可播放类成片（含 TTS、短视频） */
export function isAudioGalleryWorkType(type: string | undefined): boolean {
  const t = String(type || "").trim();
  if (isTextOnlyWorkType(t)) return false;
  return (
    t === "podcast_generate" ||
    t === "podcast" ||
    t === "podcast_short_video" ||
    t === "text_to_speech" ||
    t === "tts"
  );
}

export function workGalleryTypeChipLabel(work: Pick<WorkItem, "type" | "workProgramName">): string {
  const program = String(work.workProgramName || "").trim();
  if (program) return program.length > 24 ? `${program.slice(0, 24)}…` : program;
  return worksNavPrimaryKind(work.type);
}

export function scriptExcerptFromWork(work: Pick<WorkItem, "scriptText">, maxChars = 160): string {
  const raw = String(work.scriptText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  const chars = Array.from(raw);
  if (chars.length <= maxChars) return raw;
  return chars.slice(0, maxChars).join("") + "…";
}

export function splitWorksByGalleryKind(works: WorkItem[]): { audio: WorkItem[]; script: WorkItem[] } {
  const audio: WorkItem[] = [];
  const script: WorkItem[] = [];
  for (const w of works) {
    if (isTextOnlyWorkType(String(w.type || ""))) script.push(w);
    else if (isAudioGalleryWorkType(String(w.type || ""))) audio.push(w);
    else script.push(w);
  }
  return { audio, script };
}

export function sortWorksByRecency(works: WorkItem[]): WorkItem[] {
  return [...works].sort((a, b) => {
    const ta = new Date(String(a.createdAt || 0)).getTime();
    const tb = new Date(String(b.createdAt || 0)).getTime();
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
}
