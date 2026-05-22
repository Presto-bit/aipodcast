"use client";

import { ChevronDown, History } from "../icons";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { ClipWord } from "../../lib/clipTypes";
import type { SpeakerLine } from "../../lib/prestoFlowTranscript";
import FloatingPopover from "../ui/FloatingPopover";
import ClipRoughCutPanel from "./ClipRoughCutPanel";
import ClipScriptSearchPanel from "./ClipScriptSearchPanel";

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

function repairBtnClass(disabled: boolean) {
  return [
    "shrink-0 rounded-lg border px-2 py-1 text-[11px] font-medium shadow-soft transition",
    disabled
      ? "cursor-not-allowed border-line bg-fill/45 text-muted opacity-55"
      : "border-line bg-surface text-ink hover:bg-fill"
  ].join(" ");
}

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prdSheet, setPrdSheet] = useState<null | "verbal" | "pause">(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const verbalBtnRef = useRef<HTMLButtonElement | null>(null);
  const pauseBtnRef = useRef<HTMLButtonElement | null>(null);
  const historyBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!historyOpen && !prdSheet) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el || !(e.target instanceof Node)) return;
      if (e.target instanceof Element && e.target.closest("[data-floating-panel]")) return;
      if (!el.contains(e.target)) {
        setHistoryOpen(false);
        setPrdSheet(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [historyOpen, prdSheet]);

  const repairBusy = repairBusyKind !== "";

  const roughCutFloatingClass =
    "z-[12000] w-[min(36rem,calc(100vw-1.5rem))] overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-surface p-0 shadow-lg";

  const historyPopoverClass =
    "z-[12000] w-[min(44rem,calc(100vw-1.25rem))] max-h-[min(72vh,32rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-surface p-0 shadow-lg";

  const handleRepair = async (kind: "ambient" | "voice_clarity" | "loudnorm", run: () => void | Promise<void>) => {
    if (repairBusy) return;
    await run();
  };

  return (
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
        <div className="relative shrink-0">
          <button
            ref={verbalBtnRef}
            type="button"
            onClick={() => {
              setHistoryOpen(false);
              setPrdSheet((p) => (p === "verbal" ? null : "verbal"));
            }}
            className={[
              "rounded-lg border px-2 py-1 text-[11px] font-medium shadow-sm transition",
              prdSheet === "verbal" ? "border-brand/55 bg-brand/12 text-brand" : "border-line bg-surface text-ink hover:bg-fill"
            ].join(" ")}
          >
            识别口癖
          </button>
          <FloatingPopover
            open={prdSheet === "verbal"}
            anchorEl={verbalBtnRef.current}
            isMobile={false}
            mobileClassName=""
            desktopClassName={roughCutFloatingClass}
            ariaLabel="口癖识别"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ClipRoughCutPanel {...verbalSheetProps} variant="verbalSheet" />
          </FloatingPopover>
        </div>
        <div className="relative shrink-0">
          <button
            ref={pauseBtnRef}
            type="button"
            onClick={() => {
              setHistoryOpen(false);
              setPrdSheet((p) => (p === "pause" ? null : "pause"));
            }}
            className={[
              "rounded-lg border px-2 py-1 text-[11px] font-medium shadow-sm transition",
              prdSheet === "pause" ? "border-brand/55 bg-brand/12 text-brand" : "border-line bg-surface text-ink hover:bg-fill"
            ].join(" ")}
          >
            识别停顿
          </button>
          <FloatingPopover
            open={prdSheet === "pause"}
            anchorEl={pauseBtnRef.current}
            isMobile={false}
            mobileClassName=""
            desktopClassName={roughCutFloatingClass}
            ariaLabel="停顿识别"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ClipRoughCutPanel {...pauseSheetProps} variant="pauseSheet" />
          </FloatingPopover>
        </div>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-line/80" aria-hidden />
        <div className="relative shrink-0">
          <button
            ref={historyBtnRef}
            type="button"
            aria-label="变更历史"
            title="变更历史"
            onClick={() => {
              setPrdSheet(null);
              setHistoryOpen((o) => !o);
            }}
            className={[
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border text-[11px] font-medium transition",
              historyOpen ? "border-brand/50 bg-brand/10 text-brand" : "border-line bg-surface text-ink hover:bg-fill"
            ].join(" ")}
          >
            <History className="h-4 w-4" aria-hidden />
          </button>
          <FloatingPopover
            open={historyOpen}
            anchorEl={historyBtnRef.current}
            isMobile={false}
            mobileClassName=""
            desktopClassName={historyPopoverClass}
            ariaLabel="变更历史"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {historyPanel}
          </FloatingPopover>
        </div>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-line/80" aria-hidden />
        <span className="shrink-0 text-[10px] text-muted">音频处理</span>
        <button
          type="button"
          disabled={repairBusy}
          className={repairBtnClass(repairBusy)}
          onClick={() => void handleRepair("ambient", onRepairAmbient)}
        >
          降噪
        </button>
        <button
          type="button"
          disabled={repairBusy}
          className={repairBtnClass(repairBusy)}
          onClick={() => void handleRepair("voice_clarity", onRepairVoiceClarity)}
        >
          人声美化
        </button>
        <button
          type="button"
          disabled={repairBusy}
          className={repairBtnClass(repairBusy)}
          onClick={() => void handleRepair("loudnorm", onRepairLoudnorm)}
        >
          响度统一
        </button>
      </div>
    </div>
  );
}
