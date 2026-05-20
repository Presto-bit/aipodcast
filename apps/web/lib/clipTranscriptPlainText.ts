import type { ClipWord } from "./clipTypes";

/** 与编排器 clip_transcript_words_to_script_raw 对齐，用于 Shownotes「查看原文」 */
export function clipTranscriptWordsToPlainText(
  words: readonly ClipWord[],
  excludedIds?: Set<string> | readonly string[]
): string {
  const ex =
    excludedIds instanceof Set
      ? excludedIds
      : new Set(
          (Array.isArray(excludedIds) ? excludedIds : [])
            .map((x) => String(x).trim())
            .filter(Boolean)
        );
  const lines: string[] = [];
  let parts: string[] = [];
  let curSpk: number | null = null;

  const emitLine = (spk: number, tokens: string[]) => {
    const t = tokens.join("").trim();
    if (t) lines.push(`说话人 ${spk + 1}：${t}`);
  };

  for (const w of words) {
    if (!w?.id && !w?.text) continue;
    if (w.id && ex.has(w.id)) continue;
    const spk = Number.isFinite(w.speaker) ? w.speaker : 0;
    const tok = `${w.text || ""}${w.punct ?? ""}`;
    const uttNew = Boolean(w.utt_new);

    if (curSpk === null) curSpk = spk;

    if (uttNew && parts.length > 0) {
      emitLine(curSpk, parts);
      parts = [];
      curSpk = spk;
    } else if (spk !== curSpk) {
      if (parts.length > 0) emitLine(curSpk, parts);
      parts = [];
      curSpk = spk;
    }

    if (tok) parts.push(tok);
  }

  if (parts.length > 0 && curSpk !== null) emitLine(curSpk, parts);
  return lines.join("\n").trim();
}

export function clipProjectTranscriptPlainText(project: {
  transcript_normalized?: { words?: ClipWord[] } | null;
  excluded_word_ids?: string[];
} | null): string {
  if (!project) return "";
  const words = project.transcript_normalized?.words;
  if (!Array.isArray(words) || words.length === 0) return "";
  const excluded = new Set(
    (Array.isArray(project.excluded_word_ids) ? project.excluded_word_ids : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
  );
  return clipTranscriptWordsToPlainText(words, excluded);
}
