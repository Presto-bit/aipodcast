import type { ClipEditSuggestion, ClipWord } from "../../lib/clipTypes";

export function isDualChannels(ch: unknown): boolean {
  return Array.isArray(ch) && ch.length >= 2;
}

export type EngineHeaderState = "idle" | "queued" | "running" | "ready" | "failed";

export function mapTranscriptionToEngine(st: string | undefined): EngineHeaderState {
  if (st === "queued" || st === "running") return st === "queued" ? "queued" : "running";
  if (st === "succeeded") return "ready";
  if (st === "failed") return "failed";
  return "idle";
}

export function readRoughDismissedSet(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`presto-rough-dismiss:${projectId}`);
    const a = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(a) ? a.map(String) : []);
  } catch {
    return new Set();
  }
}

export function initialWordMarkersFromSuggestions(
  sugs: readonly ClipEditSuggestion[]
): Record<string, { suggestionKey: string; status: "pending" }> {
  const m: Record<string, { suggestionKey: string; status: "pending" }> = {};
  for (const s of sugs) {
    const ex = s.execute;
    if (!ex || (ex.kind !== "excludeWords" && ex.kind !== "keepStutterFirst")) continue;
    for (const id of ex.wordIds) m[id] = { suggestionKey: s.id, status: "pending" };
  }
  return m;
}

export function firstWordIdAtOrAfterMs(
  words: readonly ClipWord[],
  ms: number,
  excluded: ReadonlySet<string>
): string | null {
  let best: ClipWord | null = null;
  for (const w of words) {
    if (excluded.has(w.id)) continue;
    if (w.s_ms >= ms - 2) {
      if (!best || w.s_ms < best.s_ms) best = w;
    }
  }
  return best?.id ?? null;
}

export function suggestionFeedbackPayload(
  s: ClipEditSuggestion,
  kind: "suggestion_apply" | "suggestion_undo"
): Record<string, unknown> {
  const ex = s.execute;
  const wordIds =
    ex && (ex.kind === "excludeWords" || ex.kind === "keepStutterFirst") ? ex.wordIds : [];
  return {
    kind,
    suggestion_id: s.llmSuggestionId || s.id,
    parent_suggestion_id: s.parentLlmSuggestionId,
    source: s.source,
    execute_kind: ex?.kind,
    word_ids: wordIds,
    title: s.title.slice(0, 120)
  };
}

export type EditorAudioSegment = {
  id: string;
  startMs: number;
  endMs: number;
  source: "original" | "inserted";
  transcribed: boolean;
  wordIds: string[];
};

export function normalizeSegmentTimeline(segments: readonly EditorAudioSegment[]): EditorAudioSegment[] {
  let cursor = 0;
  return segments.map((seg) => {
    const duration = Math.max(120, seg.endMs - seg.startMs);
    const next: EditorAudioSegment = {
      ...seg,
      startMs: cursor,
      endMs: cursor + duration
    };
    cursor += duration;
    return next;
  });
}

export function buildInitialAudioSegments(words: readonly ClipWord[]): EditorAudioSegment[] {
  if (!words.length) return [];
  const start = Math.min(...words.map((x) => x.s_ms));
  const end = Math.max(...words.map((x) => x.e_ms));
  return [
    {
      id: "seg-main-0",
      startMs: Math.max(0, start),
      endMs: Math.max(start + 1, end),
      source: "original",
      transcribed: true,
      wordIds: words.map((x) => x.id)
    }
  ];
}

export function reorderWordsBySegments(
  words: readonly ClipWord[],
  segments: readonly EditorAudioSegment[]
): ClipWord[] {
  if (!segments.length) return [...words];
  const byId = new Map(words.map((w) => [w.id, w]));
  const out: ClipWord[] = [];
  const used = new Set<string>();
  for (const seg of segments) {
    for (const id of seg.wordIds) {
      const w = byId.get(id);
      if (!w || used.has(id)) continue;
      out.push(w);
      used.add(id);
    }
  }
  for (const w of words) {
    if (!used.has(w.id)) out.push(w);
  }
  return out;
}
