/** 与 ClipStagingTracksBar 一致：无 ffprobe 时用字节粗估时长（约 128kbps） */

export function estimateDurationMsFromBytes(bytes?: number | null): number | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const bps = 128_000;
  return Math.round((bytes * 8 * 1000) / bps);
}

export function perStagingEntryDurationMs(
  entry: { size_bytes?: number },
  approxPerSegmentMs: number | null
): number {
  const est = estimateDurationMsFromBytes(entry.size_bytes);
  if (est != null && est > 0) return est;
  const a = approxPerSegmentMs;
  return typeof a === "number" && Number.isFinite(a) && a > 0 ? Math.round(a) : 0;
}

export function sumStagingEntriesDurationMs(
  entries: readonly { size_bytes?: number }[],
  approxPerSegmentMs: number | null
): number {
  let s = 0;
  for (const e of entries) {
    s += perStagingEntryDurationMs(e, approxPerSegmentMs);
  }
  return s;
}
