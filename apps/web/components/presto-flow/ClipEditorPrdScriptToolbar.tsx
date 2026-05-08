"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import type { SpeakerLine } from "../../lib/prestoFlowTranscript";
import ClipScriptSearchPanel from "./ClipScriptSearchPanel";

export type PrdToolbarMenu =
  | null
  | "verbal"
  | "pause"
  | "history"
  | "repair_ambient"
  | "repair_dual_balance"
  | "repair_loudness";

type Props = {
  scriptSearch: string;
  onScriptSearch: (q: string) => void;
  scriptSearchInputRef: React.RefObject<HTMLInputElement | null>;
  words: readonly ClipWord[];
  lines: readonly SpeakerLine[];
  excluded: ReadonlySet<string>;
  onNavigateSearchHit: (wordId: string) => void;
  activeSearchHighlightWordId: string | null;
  onSelectAllSearchHits: () => void;
  searchAllHitsSelected: boolean;
  allSearchHitsHighlighted: boolean;
  onDeleteAllSearchHits: () => void;
  verbalPanel: ReactNode;
  pausePanel: ReactNode;
  historyPanel: ReactNode;
  repairAmbientPanel: ReactNode;
  repairVoicePanel: ReactNode;
  repairLoudnessPanel: ReactNode;
};

export default function ClipEditorPrdScriptToolbar({
  scriptSearch,
  onScriptSearch,
  scriptSearchInputRef,
  words,
  lines,
  excluded,
  onNavigateSearchHit,
  activeSearchHighlightWordId,
  onSelectAllSearchHits,
  searchAllHitsSelected,
  allSearchHitsHighlighted,
  onDeleteAllSearchHits,
  verbalPanel,
  pausePanel,
  historyPanel,
  repairAmbientPanel,
  repairVoicePanel,
  repairLoudnessPanel
}: Props) {
  const [open, setOpen] = useState<PrdToolbarMenu>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el || !(e.target instanceof Node)) return;
      if (!el.contains(e.target)) setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const btn = (id: Exclude<PrdToolbarMenu, null>, label: string) => {
    const active = open === id;
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((p) => (p === id ? null : id))}
          className={[
            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition",
            active ? "border-brand/50 bg-brand/10 text-brand" : "border-line bg-surface text-ink hover:bg-fill"
          ].join(" ")}
        >
          {label}
          <ChevronDown className={["h-3 w-3 opacity-70 transition", active ? "rotate-180" : ""].join(" ")} aria-hidden />
        </button>
        {active ? (
          <div className="absolute left-0 top-[calc(100%+4px)] z-[200] w-[min(22rem,calc(100vw-2rem)))] max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-soft">
            {id === "verbal" ? verbalPanel : null}
            {id === "pause" ? pausePanel : null}
            {id === "history" ? historyPanel : null}
          </div>
        ) : null}
      </div>
    );
  };

  const repairBtn = (menuKey: Exclude<PrdToolbarMenu, null>, label: string, panel: ReactNode) => {
    const active = open === menuKey;
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((p) => (p === menuKey ? null : menuKey))}
          className={[
            "rounded-lg border px-2 py-1 text-[11px] font-medium transition",
            active ? "border-brand/50 bg-brand/12 text-brand" : "border-line bg-surface text-ink hover:bg-fill"
          ].join(" ")}
        >
          {label}
        </button>
        {active ? (
          <div className="absolute right-0 top-[calc(100%+4px)] z-[200] w-[min(20rem,calc(100vw-2rem))] max-h-[min(70vh,26rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-soft">
            {panel}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative shrink-0 border-b border-line bg-fill/20 px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {btn("verbal", "识别口癖")}
        {btn("pause", "识别停顿")}
        <div className="mx-1 h-4 w-px bg-line/80" aria-hidden />
        <ClipScriptSearchPanel
          compactToolbar
          words={words}
          lines={lines}
          excluded={excluded}
          scriptSearch={scriptSearch}
          onScriptSearch={onScriptSearch}
          scriptSearchInputRef={scriptSearchInputRef}
          onNavigateSearchHit={onNavigateSearchHit}
          activeHighlightWordId={activeSearchHighlightWordId}
          onSelectAllSearchHits={onSelectAllSearchHits}
          searchAllHitsSelected={searchAllHitsSelected}
          allSearchHitsHighlighted={allSearchHitsHighlighted}
          onDeleteAllSearchHits={onDeleteAllSearchHits}
        />
        <div className="mx-1 h-4 w-px bg-line/80" aria-hidden />
        {btn("history", "变更历史")}
        <div className="mx-1 h-4 w-px bg-line/80" aria-hidden />
        <span className="text-[10px] text-muted">音频处理</span>
        {repairBtn("repair_ambient", "降噪", repairAmbientPanel)}
        {repairBtn("repair_dual_balance", "人声美化", repairVoicePanel)}
        {repairBtn("repair_loudness", "响度统一", repairLoudnessPanel)}
      </div>
    </div>
  );
}
