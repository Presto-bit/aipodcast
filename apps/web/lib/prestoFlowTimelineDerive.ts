import type { ClipTimelineClip, ClipTimelineDoc, ClipWord } from "./clipTypes";

/**
 * 与编排器 `build_timeline_v1_from_row` 对齐：由词表 + excluded 推导口播保留段（仅前端示意）。
 */
export function buildSpeechTimelineFromWords(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>
): ClipTimelineDoc {
  const ordered = [...words].sort((a, b) => a.s_ms - b.s_ms);
  const clips: ClipTimelineClip[] = [];
  let curIds: string[] = [];
  let curStart: number | null = null;
  let curEnd: number | null = null;

  const flush = () => {
    if (!curIds.length || curStart == null || curEnd == null) {
      curIds = [];
      curStart = null;
      curEnd = null;
      return;
    }
    clips.push({
      id: `c-${clips.length}`,
      start_ms: curStart,
      end_ms: curEnd,
      source: "transcript",
      word_ids: curIds.slice(0, 800)
    });
    curIds = [];
    curStart = null;
    curEnd = null;
  };

  for (const w of ordered) {
    if (excluded.has(w.id)) {
      flush();
      continue;
    }
    if (curStart == null) curStart = w.s_ms;
    curEnd = curEnd == null ? w.e_ms : Math.max(curEnd, w.e_ms);
    curIds.push(w.id);
  }
  flush();

  return {
    version: 1,
    tracks: [
      { id: "speech", kind: "speech", label: "speech", clips },
      { id: "music", kind: "music", label: "music", clips: [] }
    ]
  };
}
