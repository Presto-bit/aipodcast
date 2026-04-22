"use client";

import type { Ref, RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import { collectSubstringMatchWordIds } from "../../lib/prestoFlowRoughCutLexicon";
import { collectLineWordIds, displayToken, type SpeakerLine } from "../../lib/prestoFlowTranscript";
import { useI18n } from "../../lib/I18nContext";

function sentenceTextFromLine(line: SpeakerLine): string {
  const parts: string[] = [];
  for (const u of line.units) {
    if (u.kind === "single") parts.push(displayToken(u.word));
    else for (const w of u.words) parts.push(displayToken(w));
  }
  return parts.join("").trim() || "…";
}

type Props = {
  words: readonly ClipWord[];
  lines: readonly SpeakerLine[];
  excluded: ReadonlySet<string>;
  scriptSearch: string;
  onScriptSearch: (q: string) => void;
  scriptSearchInputRef?: RefObject<HTMLInputElement | null> | Ref<HTMLInputElement>;
  onNavigateSearchHit: (wordId: string) => void;
  /** 父级当前单点高亮词（用于同步「第 n 处」） */
  activeHighlightWordId: string | null;
  onSelectAllSearchHits: () => void;
  searchAllHitsSelected: boolean;
  allSearchHitsHighlighted: boolean;
  onDeleteAllSearchHits: () => void;
};

export default function ClipScriptSearchPanel({
  words,
  lines,
  excluded,
  scriptSearch,
  onScriptSearch,
  scriptSearchInputRef,
  onNavigateSearchHit,
  activeHighlightWordId,
  onSelectAllSearchHits,
  searchAllHitsSelected,
  allSearchHitsHighlighted,
  onDeleteAllSearchHits
}: Props) {
  const { t } = useI18n();
  const [hitIndex, setHitIndex] = useState(0);

  const searchIds = useMemo(
    () => collectSubstringMatchWordIds(words, scriptSearch, excluded),
    [words, scriptSearch, excluded]
  );

  useEffect(() => {
    setHitIndex(0);
  }, [scriptSearch, searchIds.length]);

  useEffect(() => {
    if (!activeHighlightWordId || !searchIds.length) return;
    const ix = searchIds.indexOf(activeHighlightWordId);
    if (ix >= 0) setHitIndex(ix);
  }, [activeHighlightWordId, searchIds]);

  const searchNavSafeIndex = useMemo(() => {
    if (searchIds.length === 0) return 0;
    return ((hitIndex % searchIds.length) + searchIds.length) % searchIds.length;
  }, [hitIndex, searchIds]);

  const jumpSearchHit = useCallback(
    (delta: number) => {
      if (!searchIds.length) return;
      const next = ((searchNavSafeIndex + delta) % searchIds.length + searchIds.length) % searchIds.length;
      setHitIndex(next);
      onNavigateSearchHit(searchIds[next]!);
    },
    [onNavigateSearchHit, searchIds, searchNavSafeIndex]
  );

  const wordToLineIndex = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach((line, li) => {
      for (const id of collectLineWordIds(line)) m.set(id, li);
    });
    return m;
  }, [lines]);

  const sentenceRows = useMemo(() => {
    const q = scriptSearch.trim();
    if (!q || !searchIds.length) return [];
    const seenLine = new Set<number>();
    const rows: { lineIndex: number; text: string; jumpWordId: string }[] = [];
    for (const wid of searchIds) {
      const li = wordToLineIndex.get(wid);
      if (li === undefined) continue;
      if (seenLine.has(li)) continue;
      seenLine.add(li);
      const line = lines[li];
      if (!line) continue;
      rows.push({ lineIndex: li, text: sentenceTextFromLine(line), jumpWordId: wid });
    }
    return rows;
  }, [scriptSearch, searchIds, lines, wordToLineIndex]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="block text-[10px] font-medium text-muted">
        {t("presto.flow.scriptSearch.label")}
        <span className="ml-1 font-normal text-muted/80">{t("presto.flow.scriptSearch.shortcutHint")}</span>
        <input
          ref={scriptSearchInputRef as Ref<HTMLInputElement> | undefined}
          type="search"
          value={scriptSearch}
          onChange={(e) => onScriptSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              jumpSearchHit(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder={t("presto.flow.scriptSearch.placeholder")}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink placeholder:text-muted"
        />
      </label>

      {scriptSearch.trim() ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <span>{t("presto.flow.scriptSearch.hits").replace("{n}", String(searchIds.length))}</span>
            {searchIds.length > 0 ? (
              <span>
                {" · "}
                {allSearchHitsHighlighted
                  ? t("presto.flow.scriptSearch.allHitsHighlighted")
                  : t("presto.flow.scriptSearch.position")
                      .replace("{i}", String(searchNavSafeIndex + 1))
                      .replace("{n}", String(searchIds.length))}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={searchIds.length === 0}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill disabled:opacity-40"
              onClick={() => jumpSearchHit(-1)}
            >
              {t("presto.flow.scriptSearch.prev")}
            </button>
            <button
              type="button"
              disabled={searchIds.length === 0}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill disabled:opacity-40"
              onClick={() => jumpSearchHit(1)}
            >
              {t("presto.flow.scriptSearch.next")}
            </button>
            <button
              type="button"
              disabled={searchIds.length === 0}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill disabled:opacity-40"
              onClick={() => onSelectAllSearchHits()}
            >
              {t("presto.flow.scriptSearch.selectAll")}
            </button>
            {searchAllHitsSelected ? (
              <button
                type="button"
                disabled={searchIds.length === 0}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill disabled:opacity-40"
                onClick={() => onDeleteAllSearchHits()}
              >
                {t("presto.flow.scriptSearch.deleteAllHits")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {sentenceRows.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-medium text-muted">{t("presto.flow.scriptSearch.sentenceListTitle")}</p>
          <ul className="flex max-h-[min(40vh,22rem)] flex-col gap-1.5 overflow-y-auto pr-0.5">
            {sentenceRows.map((row) => (
              <li key={`${row.lineIndex}-${row.jumpWordId}`}>
                <button
                  type="button"
                  title={t("presto.flow.scriptSearch.jumpSentenceTip")}
                  className="w-full rounded-lg border border-line/80 bg-surface/70 px-2 py-1.5 text-left text-[10px] leading-snug text-ink transition hover:border-brand/30 hover:bg-fill"
                  onClick={() => onNavigateSearchHit(row.jumpWordId)}
                >
                  {row.text.length > 220 ? `${row.text.slice(0, 220)}…` : row.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : scriptSearch.trim() ? (
        <p className="text-[10px] text-muted">{t("presto.flow.scriptSearch.noHits")}</p>
      ) : null}
    </div>
  );
}
