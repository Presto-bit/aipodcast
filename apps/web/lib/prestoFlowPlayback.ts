import type { ClipWord } from "./clipTypes";

/** 当前 ms 落在哪个词区间 [s_ms, e_ms)；否则 -1 */
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
