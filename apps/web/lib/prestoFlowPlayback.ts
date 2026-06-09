import type { ClipWord } from "./clipTypes";

function keptWordsSorted(words: readonly ClipWord[], excluded: ReadonlySet<string>): ClipWord[] {
  return words.filter((w) => !excluded.has(w.id)).sort((a, b) => a.s_ms - b.s_ms);
}

/**
 * 母带时间 → 剪辑试听轨近似位置（按保留词时长累加，不含短语桥接/crossfade）。
 */
export function approximateEditedTimelineMs(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  masterMs: number
): number {
  const kept = keptWordsSorted(words, excluded);
  if (!kept.length) return 0;
  const t = Math.max(0, masterMs);
  let out = 0;
  for (const w of kept) {
    if (t >= w.e_ms) {
      out += Math.max(0, w.e_ms - w.s_ms);
      continue;
    }
    if (t >= w.s_ms) {
      out += t - w.s_ms;
      return Math.max(0, Math.round(out));
    }
    return Math.max(0, Math.round(out));
  }
  return Math.max(0, Math.round(out));
}

/** 剪辑试听轨时间 → 母带近似位置，供稿面高亮与 scrub 显示。 */
export function approximateMasterTimelineMs(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  editedMs: number
): number {
  const kept = keptWordsSorted(words, excluded);
  if (!kept.length) return 0;
  let remain = Math.max(0, editedMs);
  for (const w of kept) {
    const dur = Math.max(0, w.e_ms - w.s_ms);
    if (remain <= dur) return Math.max(0, Math.round(w.s_ms + remain));
    remain -= dur;
  }
  const last = kept[kept.length - 1]!;
  return Math.max(0, Math.round(last.e_ms));
}

/** 当前 ms 落在哪个词区间 [s_ms, e_ms)；否则 -1（仅当时间在某个词块内时命中） */
export function findActiveWordIndex(words: readonly ClipWord[], ms: number): number {
  if (words.length === 0) return -1;
  let lo = 0;
  let hi = words.length - 1;
  let le = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].s_ms <= ms) {
      le = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (le < 0) return -1;
  if (ms >= words[le].s_ms && ms < words[le].e_ms) return le;
  return -1;
}

/**
 * 稿面 / 播放联动用：在词间静音、句间空隙仍高亮「当前」保留词（上一段已开口且未剪掉的词），
 * 避免时间落在空隙时整稿无高亮；不高亮已剪掉词。
 */
export function findPlaybackHighlightWordIndex(
  words: readonly ClipWord[],
  ms: number,
  excluded: ReadonlySet<string>
): number {
  if (words.length === 0) return -1;
  const t = Math.max(0, ms);
  let best = -1;
  let bestStart = -Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (excluded.has(w.id)) continue;
    if (w.s_ms <= t && w.s_ms >= bestStart) {
      bestStart = w.s_ms;
      best = i;
    }
  }
  if (best >= 0) return best;
  for (let i = 0; i < words.length; i++) {
    if (!excluded.has(words[i]!.id)) return i;
  }
  return -1;
}

/**
 * 试听时跳过已「剪掉」的词：若当前时间落在 excluded 词块内，跳到该块结束之后；
 * 可能连续多块，循环直至落在保留区间或超出时长。
 */
export function adjustPlaybackMsForExcluded(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  ms: number,
  durationMs?: number | null
): number {
  if (words.length === 0 || excluded.size === 0) return ms;
  const cap =
    typeof durationMs === "number" && durationMs > 0
      ? durationMs
      : Math.max(...words.map((w) => w.e_ms), 0) + 1;
  let cur = Math.max(0, ms);
  const maxIter = Math.min(words.length + 4, 500);
  for (let n = 0; n < maxIter; n += 1) {
    let jumped = false;
    for (const w of words) {
      if (!excluded.has(w.id)) continue;
      if (cur >= w.s_ms && cur < w.e_ms) {
        cur = w.e_ms;
        jumped = true;
        break;
      }
    }
    if (!jumped) break;
    if (cur >= cap) return cap;
  }
  return cur;
}

function isInsideAnyKeptWord(words: readonly ClipWord[], excluded: ReadonlySet<string>, ms: number): boolean {
  for (const w of words) {
    if (excluded.has(w.id)) continue;
    if (ms >= w.s_ms && ms < w.e_ms) return true;
  }
  return false;
}

/**
 * 若当前落在「保留词之间的空隙」且距下一词起点较远，将播放头略前移以便听到词前气息（Descript 式预听）。
 */
export function applyPlaybackPreRollBeforeNextKept(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  ms: number,
  opts?: { prerollMs?: number; minGapMs?: number }
): number {
  const prerollMs = opts?.prerollMs ?? 90;
  const minGapMs = opts?.minGapMs ?? 160;
  if (words.length === 0 || prerollMs <= 0 || minGapMs <= 0) return ms;
  if (isInsideAnyKeptWord(words, excluded, ms)) return ms;
  let nextS: number | null = null;
  for (const w of words) {
    if (excluded.has(w.id)) continue;
    if (w.s_ms > ms) {
      if (nextS == null || w.s_ms < nextS) nextS = w.s_ms;
    }
  }
  if (nextS == null) return ms;
  const gap = nextS - ms;
  if (gap < minGapMs) return ms;
  return Math.max(0, nextS - prerollMs);
}

/**
 * 稿面单击/跳转定位后：播放回调应优先「待在焦点词」附近，避免 pre-roll 或跳过已剪逻辑把游标拽走。
 * 若 raw 落在**另一块**已剪词内部则返回 false，以便仍按全局规则跳出该块。
 */
export function rawWithinFocusWordPlaybackHold(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  focusedId: string | null,
  rawMs: number,
  opts?: { leadMs?: number; tailPadMs?: number }
): boolean {
  if (!focusedId || words.length === 0) return false;
  const fw = words.find((x) => x.id === focusedId);
  if (!fw) return false;
  const lead = opts?.leadMs ?? 72;
  const tail = opts?.tailPadMs ?? 28;
  const lo = fw.s_ms - lead;
  const hi = fw.e_ms + tail;
  const t = rawMs;
  if (t < lo || t >= hi) return false;
  for (const w of words) {
    if (w.id === focusedId) continue;
    if (!excluded.has(w.id)) continue;
    if (t >= w.s_ms && t < w.e_ms) return false;
  }
  return true;
}

/** 将 seek 时间磁吸到最近的词边界（起止点），阈值内生效。 */
export function snapMsNearWordEdges(
  words: readonly ClipWord[],
  ms: number,
  thresholdMs: number
): number {
  if (words.length === 0 || thresholdMs <= 0) return ms;
  let best = ms;
  let bestDist = thresholdMs + 1;
  for (const w of words) {
    for (const edge of [w.s_ms, w.e_ms]) {
      const d = Math.abs(edge - ms);
      if (d <= thresholdMs && d < bestDist) {
        bestDist = d;
        best = edge;
      }
    }
  }
  return best;
}
