import type { ClipAudioStagingEntry, ClipWord } from "./clipTypes";

export type VirtualAudioCue = {
  objectKey: string;
  url: string;
  startGlobalMs: number;
  durationMs: number;
};

/** 由分段顺序 + 词级 seg_key/s_seg_ms 推导每段在虚拟整轨上的时长与起点 */
export function buildVirtualAudioCues(
  projectId: string,
  entries: readonly ClipAudioStagingEntry[],
  words: readonly ClipWord[],
  fallbackDurationMs: number
): VirtualAudioCue[] {
  if (!entries.length) return [];
  const maxBySeg = new Map<string, number>();
  for (const w of words) {
    const rec = w as ClipWord & { seg_key?: string; e_seg_ms?: number };
    const k = rec.seg_key?.trim();
    if (!k) continue;
    const e = typeof rec.e_seg_ms === "number" ? rec.e_seg_ms : rec.e_ms;
    maxBySeg.set(k, Math.max(maxBySeg.get(k) ?? 0, e));
  }
  let pos = 0;
  const cues: VirtualAudioCue[] = [];
  const fallbackSlice =
    fallbackDurationMs > 0 && maxBySeg.size === 0
      ? Math.max(30_000, Math.ceil(fallbackDurationMs / Math.max(1, entries.length)))
      : 60_000;
  for (const ent of entries) {
    const k = String(ent.key || "").trim();
    if (!k) continue;
    const durRaw = maxBySeg.get(k);
    const durationMs = durRaw && durRaw > 0 ? durRaw : fallbackSlice;
    cues.push({
      objectKey: k,
      url: `/api/clip/projects/${encodeURIComponent(projectId)}/audio/source-segment/file?object_key=${encodeURIComponent(k)}`,
      startGlobalMs: pos,
      durationMs,
    });
    pos += durationMs;
  }
  return cues;
}

export function totalVirtualDurationMs(cues: readonly VirtualAudioCue[]): number {
  if (!cues.length) return 0;
  const last = cues[cues.length - 1]!;
  return last.startGlobalMs + last.durationMs;
}
