import type { ClipAudioStagingEntry, ClipWord } from "./clipTypes";

/** 词级 seg_key 对应素材分段内的最大结束毫秒（与 stitch / 虚拟轨一致），用于素材列表展示时长 */
export function maxSegDurationMsByKeyFromWords(words: readonly ClipWord[]): Record<string, number> {
  const maxBySeg = new Map<string, number>();
  for (const w of words) {
    const rec = w as ClipWord & { seg_key?: string; e_seg_ms?: number };
    const k = rec.seg_key?.trim();
    if (!k) continue;
    const e = typeof rec.e_seg_ms === "number" ? rec.e_seg_ms : rec.e_ms;
    maxBySeg.set(k, Math.max(maxBySeg.get(k) ?? 0, e));
  }
  return Object.fromEntries(maxBySeg);
}

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
  fallbackDurationMs: number,
  /** 无词级 seg 时间时优先使用（与素材库列表 estimate 一致），按 object_key */
  perKeyFallbackMs?: Readonly<Record<string, number>> | null
): VirtualAudioCue[] {
  if (!entries.length) return [];
  const maxBySeg = new Map<string, number>(Object.entries(maxSegDurationMsByKeyFromWords(words)));
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
    const fromEst = perKeyFallbackMs?.[k];
    const durationMs =
      durRaw && durRaw > 0
        ? durRaw
        : typeof fromEst === "number" && fromEst > 0
          ? fromEst
          : fallbackSlice;
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

/**
 * 多段虚拟拼接轨：词的全局播放毫秒须按「当前素材顺序 + cue 起点 + 段内 s_seg_ms」计算，
 * 不能直接用 s_ms（用户重排分段后 s_ms 可能与当前 cue 时间轴不一致）。
 */
export function clipWordGlobalPlaybackMs(w: ClipWord, cues: readonly VirtualAudioCue[] | null | undefined): number {
  const k = String(w.seg_key || "").trim();
  const sSeg = typeof w.s_seg_ms === "number" && Number.isFinite(w.s_seg_ms) ? w.s_seg_ms : null;
  const list = cues && cues.length ? cues : null;
  if (k && sSeg != null && list) {
    const cue = list.find((c) => c.objectKey === k);
    if (cue) return Math.max(0, Math.round(cue.startGlobalMs + sSeg));
  }
  return Math.max(0, Math.round(w.s_ms));
}

/** 素材顺序 + 各段时长（与虚拟拼接轨一致），用于总进度条上的分段色块 */
export type MaterialTimelineSlice = {
  startMs: number;
  durationMs: number;
};

export function buildMaterialTimelineSlices(
  entries: readonly { key?: string }[],
  words: readonly ClipWord[],
  fallbackTotalMs: number,
  perKeyFallbackMs?: Readonly<Record<string, number>> | null
): { slices: MaterialTimelineSlice[]; totalMs: number } {
  if (!entries.length) return { slices: [], totalMs: 0 };
  const maxBySeg = new Map<string, number>(Object.entries(maxSegDurationMsByKeyFromWords(words)));
  const fallbackSlice =
    fallbackTotalMs > 0 && maxBySeg.size === 0
      ? Math.max(30_000, Math.ceil(fallbackTotalMs / Math.max(1, entries.length)))
      : 60_000;
  let pos = 0;
  const slices: MaterialTimelineSlice[] = [];
  for (const ent of entries) {
    const k = String(ent.key || "").trim();
    if (!k) continue;
    const durRaw = maxBySeg.get(k);
    const fromEst = perKeyFallbackMs?.[k];
    const durationMs =
      durRaw && durRaw > 0
        ? durRaw
        : typeof fromEst === "number" && fromEst > 0
          ? fromEst
          : fallbackSlice;
    slices.push({ startMs: pos, durationMs });
    pos += durationMs;
  }
  return { slices, totalMs: pos };
}
