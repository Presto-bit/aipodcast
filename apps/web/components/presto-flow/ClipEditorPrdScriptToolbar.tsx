"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import type { SpeakerLine } from "../../lib/prestoFlowTranscript";
import ClipRoughCutPanel from "./ClipRoughCutPanel";
import ClipScriptSearchPanel from "./ClipScriptSearchPanel";

export type PrdToolbarMenu = null | "history";

type RoughSheetProps = ComponentProps<typeof ClipRoughCutPanel>;

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
  verbalSheetProps: RoughSheetProps;
  pauseSheetProps: RoughSheetProps;
  historyPanel: ReactNode;
  onRepairAmbient: () => void | Promise<void>;
  onRepairVoiceClarity: () => void | Promise<void>;
  onRepairLoudnorm: () => void | Promise<void>;
  repairBusyKind: "" | "ambient" | "voice_clarity" | "loudnorm";
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
  verbalSheetProps,
  pauseSheetProps,
  historyPanel,
  onRepairAmbient,
  onRepairVoiceClarity,
  onRepairLoudnorm,
  repairBusyKind
}: Props) {
  const [open, setOpen] = useState<PrdToolbarMenu>(null);
  const [verbalSheetOpen, setVerbalSheetOpen] = useState(false);
  const [pauseSheetOpen, setPauseSheetOpen] = useState(false);
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
            {historyPanel}
          </div>
        ) : null}
      </div>
    );
  };

  const repairBusy = repairBusyKind !== "";

  return (
    <>
      <div ref={rootRef} className="relative shrink-0 border-b border-line bg-fill/20 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="mx-0.5 h-4 w-px shrink-0 bg-line/80" aria-hidden />
          <button
            type="button"
            onClick={() => {
              setVerbalSheetOpen(true);
              setPauseSheetOpen(false);
            }}
            className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-soft hover:bg-fill"
          >
            识别口癖
          </button>
          <button
            type="button"
            onClick={() => {
              setPauseSheetOpen(true);
              setVerbalSheetOpen(false);
            }}
            className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-soft hover:bg-fill"
          >
            识别停顿
          </button>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-line/80" aria-hidden />
          {btn("history", "变更历史")}
          <div className="mx-0.5 h-4 w-px shrink-0 bg-line/80" aria-hidden />
          <span className="shrink-0 text-[10px] text-muted">音频处理</span>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => void onRepairAmbient()}
            className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-soft hover:bg-fill disabled:opacity-45"
          >
            {repairBusyKind === "ambient" ? "…" : "降噪"}
          </button>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => void onRepairVoiceClarity()}
            className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-soft hover:bg-fill disabled:opacity-45"
          >
            {repairBusyKind === "voice_clarity" ? "…" : "人声美化"}
          </button>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => void onRepairLoudnorm()}
            className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-soft hover:bg-fill disabled:opacity-45"
          >
            {repairBusyKind === "loudnorm" ? "…" : "响度统一"}
          </button>
        </div>
      </div>

      {verbalSheetOpen ? (
        <div
          className="fixed inset-0 z-[15000] flex items-end justify-center bg-black/35 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          role="presentation"
          onClick={() => setVerbalSheetOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="识别口癖"
            className="max-h-[85vh] w-full max-w-[1600px] overflow-hidden rounded-t-xl border border-line bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ClipRoughCutPanel
              {...verbalSheetProps}
              variant="verbalSheet"
              onClose={() => setVerbalSheetOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {pauseSheetOpen ? (
        <div
          className="fixed inset-0 z-[15000] flex items-end justify-center bg-black/35 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          role="presentation"
          onClick={() => setPauseSheetOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="识别停顿"
            className="max-h-[85vh] w-full max-w-[1600px] overflow-hidden rounded-t-xl border border-line bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ClipRoughCutPanel
              {...pauseSheetProps}
              variant="pauseSheet"
              onClose={() => setPauseSheetOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
