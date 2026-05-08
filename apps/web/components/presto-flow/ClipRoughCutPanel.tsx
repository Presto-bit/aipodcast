"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleX,
  Scissors
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipExportPausePolicy, ClipProjectRow, ClipSilenceSegment, ClipWord } from "../../lib/clipTypes";
import type { ClipEditSuggestion, ClipOutlineSource } from "../../lib/prestoFlowAiSuggestions";
import { aggregateVerbalTicRows, collectVerbalTicWordIds } from "../../lib/prestoFlowRoughCutLexicon";
import { displayToken, orderWordIdsByTranscript } from "../../lib/prestoFlowTranscript";
import { useI18n } from "../../lib/I18nContext";

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function silenceRowKey(start: number, end: number): string {
  return `sil:${Math.round(start)}-${Math.round(end)}`;
}

function silenceBridgeLabel(
  words: readonly ClipWord[],
  start: number,
  end: number,
  excluded: ReadonlySet<string>
): string {
  let prev: ClipWord | null = null;
  let next: ClipWord | null = null;
  for (const w of words) {
    if (excluded.has(w.id)) continue;
    if (w.e_ms <= start) prev = w;
    if (w.s_ms >= end && next == null) next = w;
  }
  const p = prev ? displayToken(prev) : "…";
  const n = next ? displayToken(next) : "…";
  return `${p} · ${n}`;
}

function idsSetMatchSelection(ids: readonly string[], sel?: ReadonlySet<string>): boolean {
  if (!sel || sel.size === 0) return false;
  if (ids.length !== sel.size) return false;
  return ids.every((id) => sel.has(id));
}

/** 静音检测原始间隔（ms），供「最短停顿时长」筛选 */
function silenceGapsFromSegments(segments: readonly ClipSilenceSegment[] | null): { start: number; end: number; dur: number }[] {
  if (!Array.isArray(segments) || !segments.length) return [];
  const rows: { start: number; end: number; dur: number }[] = [];
  for (const s of segments) {
    const a = Number(s.start_ms);
    const b = Number(s.end_ms);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const dur = b - a;
    if (dur < 80) continue;
    rows.push({ start: a, end: b, dur });
  }
  return rows.sort((x, y) => y.dur - x.dur);
}

function firstWordIdAtOrAfterMs(
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

function suggestionPrimaryLine(s: ClipEditSuggestion, words: readonly ClipWord[]): string {
  const wid = s.wordId;
  if (wid) {
    const w = words.find((x) => x.id === wid);
    if (w) {
      const t = displayToken(w).trim();
      if (t) return t;
    }
  }
  const m = s.body.match(/「([^」]{1,48})」/u);
  if (m?.[1]) return m[1]!;
  const m2 = s.body.match(/连续「([^」]+)」/u);
  if (m2?.[1]) return m2[1]!;
  return s.title.slice(0, 40);
}

type Props = {
  projectId: string;
  project: ClipProjectRow;
  words: readonly ClipWord[];
  excluded: ReadonlySet<string>;
  onMarkExcluded: (wordIds: readonly string[]) => void;
  onMarkRestored: (wordIds: readonly string[]) => void;
  onProjectPatch: (p: ClipProjectRow) => void;
  getAuthHeaders: () => Record<string, string>;
  onRefreshProject: () => Promise<void>;
  onError: (msg: string) => void;
  silenceSegments: readonly ClipSilenceSegment[] | null;
  /** 与稿面框选一致：口癖/建议条点击时同步多选词 id */
  multiSelectIds?: ReadonlySet<string>;
  onSelectWordIdsForSheet?: (ids: readonly string[]) => void;
  onJumpWord?: (wordId: string, opts?: { lineEndAutopause?: boolean }) => void;
  onSeekPreviewMs?: (ms: number) => void;
  onRefreshSilences?: () => void | Promise<void>;
  silenceCutKeys?: ReadonlySet<string>;
  onToggleSilenceCut?: (startMs: number, endMs: number) => void;
  onSetSilenceCapMs?: (startMs: number, endMs: number, capMs: number) => void;
  /** 口癖 / 叠字 / 规则 / AI 等可执行建议（已在外层过滤 dismiss） */
  roughCutSuggestions: readonly ClipEditSuggestion[];
  onExecuteSuggestion: (s: ClipEditSuggestion) => void;
  dismissedRoughKeys: ReadonlySet<string>;
  onToggleDismissRoughKey: (id: string) => void;
  outlineExpandBusy: boolean;
  onExpandOutline?: (src: ClipOutlineSource) => void;
  /** 主音频已就绪（与编辑器 hasServerAudio 一致） */
  hasServerAudio: boolean;
  /** 波形区是否正在播放词链试听轨 */
  wordchainPreviewActive?: boolean;
  wordchainPreviewBusy?: boolean;
  onGenerateWordchainPreview?: () => void | Promise<void>;
  onExitWordchainPreview?: () => void;
  /** 稿面工具条下拉：优先展开口癖区或停顿区 */
  toolbarFocus?: "verbal" | "pause" | null;
  /** PRD 横向底栏：仅渲染对应分区 */
  variant?: "default" | "verbalSheet" | "pauseSheet";
};

function iconBtnClass(disabled?: boolean) {
  return [
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/80 bg-surface text-ink transition hover:bg-fill",
    disabled ? "pointer-events-none opacity-40" : ""
  ].join(" ");
}

export default function ClipRoughCutPanel({
  projectId,
  project,
  words,
  excluded,
  onMarkExcluded,
  onMarkRestored,
  onProjectPatch,
  getAuthHeaders,
  onRefreshProject,
  onError,
  silenceSegments,
  multiSelectIds,
  onSelectWordIdsForSheet,
  onJumpWord,
  onSeekPreviewMs,
  onRefreshSilences,
  silenceCutKeys,
  onToggleSilenceCut,
  onSetSilenceCapMs,
  roughCutSuggestions,
  onExecuteSuggestion,
  dismissedRoughKeys,
  onToggleDismissRoughKey,
  outlineExpandBusy,
  onExpandOutline,
  hasServerAudio,
  wordchainPreviewActive = false,
  wordchainPreviewBusy = false,
  onGenerateWordchainPreview,
  onExitWordchainPreview,
  toolbarFocus = null,
  variant = "default"
}: Props) {
  const { t } = useI18n();
  const [pauseBusy, setPauseBusy] = useState(false);
  const [silenceBusy, setSilenceBusy] = useState(false);
  /** 口癖调整 / 缩短停顿：侧栏分区默认折叠 */
  const [verbalAdjustOpen, setVerbalAdjustOpen] = useState(false);
  const [pauseSectionOpen, setPauseSectionOpen] = useState(false);
  /** 识别停顿弹层：最短停顿时长（毫秒）与输入框草稿 */
  const [pauseFilterMs, setPauseFilterMs] = useState(2500);
  const [pauseMinMsDraft, setPauseMinMsDraft] = useState("2500");
  /** 口癖行 / 建议行：重复点击同一行时按转写顺序轮换跳转的词 */
  const verbalJumpCycleRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!toolbarFocus) return;
    if (toolbarFocus === "verbal") {
      setVerbalAdjustOpen(true);
      setPauseSectionOpen(false);
    } else {
      setPauseSectionOpen(true);
      setVerbalAdjustOpen(false);
    }
  }, [toolbarFocus]);

  useEffect(() => {
    verbalJumpCycleRef.current = {};
  }, [projectId]);

  const pausePolicy = project.export_pause_policy;
  const pauseEnabled = Boolean(pausePolicy?.enabled);
  const transcriptionSucceeded = project.transcription_status === "succeeded";
  const longGapMs = pauseEnabled ? Math.max(500, Number(pausePolicy?.long_gap_ms) || 2000) : 2500;

  useEffect(() => {
    setPauseFilterMs(longGapMs);
    setPauseMinMsDraft(String(longGapMs));
  }, [longGapMs]);

  const longSilenceRows = useMemo(() => {
    const segs = silenceSegments;
    if (!Array.isArray(segs) || !segs.length) return [];
    const rows: { start: number; end: number; dur: number }[] = [];
    for (const s of segs) {
      const a = Number(s.start_ms);
      const b = Number(s.end_ms);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
      const dur = b - a;
      if (dur >= longGapMs) rows.push({ start: a, end: b, dur });
    }
    return rows.sort((x, y) => y.dur - x.dur);
  }, [silenceSegments, longGapMs]);


  const ticIds = useMemo(() => collectVerbalTicWordIds(words, excluded, undefined), [words, excluded]);
  const ticAggRows = useMemo(() => aggregateVerbalTicRows(words, excluded, undefined, 20), [words, excluded]);

  const hasVerbalAdjust = ticAggRows.length > 0 || roughCutSuggestions.length > 0;

  const suggestionBadge = useCallback(
    (s: ClipEditSuggestion) => {
      if (s.id.startsWith("stutter-")) return t("presto.flow.roughCut.badgeStutter");
      return t("presto.flow.roughCut.badgeTic");
    },
    [t]
  );

  const suggestionBadgeTone = useCallback((s: ClipEditSuggestion) => {
    if (s.id.startsWith("stutter-")) return "bg-amber-500/15 text-amber-900 dark:text-amber-100";
    return "bg-rose-500/15 text-rose-800 dark:text-rose-100";
  }, []);

  const jumpVerbalRow = useCallback(
    (cycleKey: string, orderedIds: readonly string[]) => {
      if (!onJumpWord || orderedIds.length === 0) return;
      const cur = verbalJumpCycleRef.current[cycleKey] ?? -1;
      const next = (cur + 1) % orderedIds.length;
      verbalJumpCycleRef.current[cycleKey] = next;
      onJumpWord(orderedIds[next]!, { lineEndAutopause: true });
    },
    [onJumpWord]
  );

  const savePausePolicy = useCallback(
    async (next: ClipExportPausePolicy | null) => {
      setPauseBusy(true);
      onError("");
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ export_pause_policy: next })
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          project?: ClipProjectRow;
          detail?: string;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存失败 ${res.status}`);
        }
        if (data.project) onProjectPatch(data.project);
        await onRefreshProject();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setPauseBusy(false);
      }
    },
    [getAuthHeaders, onError, onProjectPatch, onRefreshProject, projectId]
  );

  const refreshSilencesClick = useCallback(async () => {
    if (!onRefreshSilences) return;
    setSilenceBusy(true);
    onError("");
    try {
      await onRefreshSilences();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setSilenceBusy(false);
    }
  }, [onError, onRefreshSilences]);

  const hasAnyHint = hasVerbalAdjust || longSilenceRows.length > 0;
  const silenceCutCount = silenceCutKeys?.size ?? 0;

  const allSilenceGaps = useMemo(() => silenceGapsFromSegments(silenceSegments), [silenceSegments]);
  const visiblePauseRowsForSheet = useMemo(
    () => allSilenceGaps.filter((r) => r.dur >= pauseFilterMs),
    [allSilenceGaps, pauseFilterMs]
  );

  const [prdPauseSelectedKeys, setPrdPauseSelectedKeys] = useState<Set<string>>(() => new Set());

  const applyVerbalDeleteForKey = useCallback(
    (key: string) => {
      if (key.startsWith("tic:")) {
        const core = key.slice(4);
        const row = ticAggRows.find((r) => r.coreKey === core);
        if (row?.activeIds.length) onMarkExcluded(row.activeIds);
        return;
      }
      if (key.startsWith("sug:")) {
        const sid = key.slice(4);
        const s = roughCutSuggestions.find((x) => x.id === sid);
        if (!s) return;
        const ex = s.execute;
        if (ex?.kind === "excludeWords") {
          const active = ex.wordIds.filter((id) => !excluded.has(id));
          if (active.length) onMarkExcluded(active);
        } else if (ex?.kind === "keepStutterFirst") {
          const toggleIds = ex.wordIds.slice(1);
          const active = toggleIds.filter((id) => !excluded.has(id));
          if (active.length) onExecuteSuggestion(s);
          else if (toggleIds.some((id) => excluded.has(id))) onMarkRestored(toggleIds.filter((id) => excluded.has(id)));
        }
      }
    },
    [excluded, onExecuteSuggestion, onMarkExcluded, onMarkRestored, roughCutSuggestions, ticAggRows]
  );

  const rowLabelCls =
    "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted";

  if (variant === "verbalSheet") {
    const chipBase =
      "max-w-[14rem] truncate rounded border px-2 py-0.5 text-left text-[11px] font-medium transition outline-none";
    const chipSelected = "z-[1] bg-zinc-200 text-ink ring-1 ring-zinc-300 dark:bg-zinc-700/65 dark:ring-zinc-500/60";
    const chipIdle = "border-line bg-surface hover:bg-fill";

    const findVerbalSheetKeyBySelection = (): string | null => {
      if (!multiSelectIds?.size) return null;
      for (const row of ticAggRows) {
        if (row.activeIds.length && idsSetMatchSelection(row.activeIds, multiSelectIds)) return `tic:${row.coreKey}`;
      }
      for (const s of roughCutSuggestions) {
        const ex = s.execute;
        if (ex?.kind === "excludeWords") {
          const active = ex.wordIds.filter((id) => !excluded.has(id));
          if (active.length && idsSetMatchSelection(active, multiSelectIds)) return `sug:${s.id}`;
        } else if (ex?.kind === "keepStutterFirst") {
          const tail = ex.wordIds.slice(1).filter((id) => !excluded.has(id));
          if (tail.length && idsSetMatchSelection(tail, multiSelectIds)) return `sug:${s.id}`;
        }
      }
      return null;
    };
    const selectedVerbalSheetKey = findVerbalSheetKeyBySelection();

    return (
      <div className="flex max-h-[min(52vh,22rem)] flex-col gap-2 overflow-y-auto p-2 text-ink">
        <div>
          <span className={rowLabelCls}>口癖</span>
          <div className="flex flex-wrap gap-1.5">
            {ticAggRows.map((row) => {
              const dismissId = `tic:${row.coreKey}`;
              const orderedTicIds = orderWordIdsByTranscript([...row.activeIds, ...row.excludedIds], words);
              const selected = idsSetMatchSelection(row.activeIds, multiSelectIds);
              return (
                <button
                  key={dismissId}
                  type="button"
                  disabled={orderedTicIds.length === 0 || !onJumpWord}
                  className={[chipBase, selected ? chipSelected : chipIdle].join(" ")}
                  title={row.label}
                  onClick={() => {
                    onSelectWordIdsForSheet?.(row.activeIds);
                    jumpVerbalRow(dismissId, orderedTicIds);
                  }}
                >
                  <span className="text-rose-700 dark:text-rose-200">{row.label}</span>
                  <span className="ml-1 font-normal text-muted">×{row.activeIds.length}</span>
                </button>
              );
            })}
            {roughCutSuggestions.map((s) => {
              const ex = s.execute;
              const orderedJumpIds =
                ex?.kind === "excludeWords" || ex?.kind === "keepStutterFirst"
                  ? orderWordIdsByTranscript(ex.wordIds, words)
                  : s.wordId
                    ? [s.wordId]
                    : [];
              const sk = `sug:${s.id}`;
              const primary = suggestionPrimaryLine(s, words);
              const selectIds =
                ex?.kind === "excludeWords"
                  ? ex.wordIds.filter((id) => !excluded.has(id))
                  : ex?.kind === "keepStutterFirst"
                    ? ex.wordIds.slice(1).filter((id) => !excluded.has(id))
                    : orderedJumpIds;
              const selected = selectIds.length ? idsSetMatchSelection(selectIds, multiSelectIds) : false;
              return (
                <button
                  key={sk}
                  type="button"
                  disabled={orderedJumpIds.length === 0 || !onJumpWord}
                  className={[chipBase, selected ? chipSelected : chipIdle].join(" ")}
                  onClick={() => {
                    if (selectIds.length) onSelectWordIdsForSheet?.(selectIds);
                    jumpVerbalRow(`sug:${s.id}`, orderedJumpIds);
                  }}
                >
                  <span
                    className={[
                      "mr-1 shrink-0 rounded px-1 py-px text-[9px] font-semibold",
                      suggestionBadgeTone(s)
                    ].join(" ")}
                  >
                    {suggestionBadge(s)}
                  </span>
                  <span>{primary}</span>
                </button>
              );
            })}
            {!ticAggRows.length && !roughCutSuggestions.length ? (
              <span className="text-[10px] text-muted">{t("presto.flow.roughCut.unifiedEmpty")}</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line/80 pt-2">
          <button
            type="button"
            disabled={!selectedVerbalSheetKey}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold shadow-sm hover:bg-fill disabled:opacity-40"
            onClick={() => {
              if (selectedVerbalSheetKey) applyVerbalDeleteForKey(selectedVerbalSheetKey);
            }}
          >
            删除
          </button>
          <button
            type="button"
            disabled={ticIds.length === 0}
            className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-40"
            onClick={() => onMarkExcluded(ticIds)}
          >
            {t("presto.flow.roughCut.fillerCutAll")}
          </button>
        </div>
      </div>
    );
  }

  if (variant === "pauseSheet") {
    const cutAllVisibleSilences = () => {
      if (!onToggleSilenceCut) return;
      const rows = prdPauseSelectedKeys.size
        ? visiblePauseRowsForSheet.filter((r) => prdPauseSelectedKeys.has(silenceRowKey(r.start, r.end)))
        : visiblePauseRowsForSheet;
      for (const r of rows) {
        const sk = silenceRowKey(r.start, r.end);
        if (!silenceCutKeys?.has(sk)) onToggleSilenceCut(r.start, r.end);
      }
    };

    const toggleSelectedSilences = () => {
      if (!onToggleSilenceCut || prdPauseSelectedKeys.size === 0) return;
      for (const sk of prdPauseSelectedKeys) {
        const row = visiblePauseRowsForSheet.find((r) => silenceRowKey(r.start, r.end) === sk);
        if (row) onToggleSilenceCut(row.start, row.end);
      }
    };

    const applyPauseMinQuery = () => {
      const n = Math.max(0, Math.floor(Number(pauseMinMsDraft.replace(/[^\d]/g, "")) || 0));
      setPauseFilterMs(n);
      const next = new Set<string>();
      for (const r of allSilenceGaps) {
        if (r.dur >= n) next.add(silenceRowKey(r.start, r.end));
      }
      setPrdPauseSelectedKeys(next);
    };

    return (
      <div className="flex max-h-[min(52vh,22rem)] flex-col gap-2 overflow-y-auto p-2 text-ink">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[8rem] flex-1 flex-col gap-0.5 text-[10px] text-muted">
            <span>最短停顿时长（ms）</span>
            <input
              type="text"
              inputMode="numeric"
              value={pauseMinMsDraft}
              onChange={(e) => setPauseMinMsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPauseMinQuery();
                }
              }}
              className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink"
            />
          </label>
          {onRefreshSilences ? (
            <button
              type="button"
              disabled={silenceBusy}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold hover:bg-fill disabled:opacity-40"
              onClick={() => void refreshSilencesClick()}
            >
              {silenceBusy ? "…" : "刷新"}
            </button>
          ) : null}
        </div>
        <p className="text-[9px] leading-snug text-muted">
          回车：列出并选中时长 ≥ 输入值（ms）的停顿。导出压缩策略见侧栏「缩短停顿」（当前导出{pauseEnabled ? "开" : "关"}，参考阈值 {longGapMs}
          ms）。
        </p>

        <div>
          <span className={rowLabelCls}>长停顿</span>
          <div className="flex flex-wrap gap-1.5">
            {visiblePauseRowsForSheet.map((r) => {
              const sk = silenceRowKey(r.start, r.end);
              const bridge = silenceBridgeLabel(words, r.start, r.end, excluded);
              const jumpId = firstWordIdAtOrAfterMs(words, r.end, excluded);
              const cut = Boolean(silenceCutKeys?.has(sk));
              const active = prdPauseSelectedKeys.has(sk);
              return (
                <button
                  key={sk}
                  type="button"
                  disabled={(!jumpId || !onJumpWord) && !onSeekPreviewMs}
                  className={[
                    "max-w-[18rem] truncate rounded border px-2 py-0.5 text-left text-[10px] transition outline-none",
                    active
                      ? "z-[1] bg-zinc-200 text-ink ring-1 ring-zinc-300 dark:bg-zinc-700/65 dark:ring-zinc-500/60"
                      : "border-line bg-surface hover:bg-fill",
                    cut ? "line-through opacity-80" : ""
                  ].join(" ")}
                  title={bridge}
                  onClick={() => {
                    setPrdPauseSelectedKeys(new Set([sk]));
                    if (jumpId && onJumpWord) onJumpWord(jumpId);
                    onSeekPreviewMs?.(r.end + 1);
                  }}
                >
                  {formatMs(r.start)}–{formatMs(r.end)} · {(Math.round(r.dur / 100) / 10).toFixed(1)}s
                </button>
              );
            })}
            {!visiblePauseRowsForSheet.length ? (
              <span className="text-[10px] text-muted">{t("presto.flow.roughCut.pauseNoLongSilences")}</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line/80 pt-2">
          <button
            type="button"
            disabled={!prdPauseSelectedKeys.size || !onToggleSilenceCut}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold shadow-sm hover:bg-fill disabled:opacity-40"
            onClick={() => toggleSelectedSilences()}
          >
            删除选中
          </button>
          <button
            type="button"
            disabled={!visiblePauseRowsForSheet.length || !onToggleSilenceCut}
            className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-40"
            onClick={() => cutAllVisibleSilences()}
          >
            全部删除
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-1">
      <section className="rounded-xl border border-line bg-fill/30 p-3">
        {!hasAnyHint ? (
          <p className="text-[10px] leading-relaxed text-muted">{t("presto.flow.roughCut.unifiedEmpty")}</p>
        ) : (
          <>
            {hasVerbalAdjust ? (
              <div className="mb-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-1 rounded-lg border border-line/60 bg-surface/50 px-2 py-1.5 text-left text-[11px] font-semibold text-ink transition hover:bg-fill"
                  aria-expanded={verbalAdjustOpen}
                  onClick={() => setVerbalAdjustOpen((o) => !o)}
                >
                  {verbalAdjustOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  )}
                  <span>{t("presto.flow.roughCut.verbalAdjustSectionTitle")}</span>
                  <span className="ml-auto text-[10px] font-normal text-muted">
                    {ticAggRows.length + roughCutSuggestions.length}
                    {t("presto.flow.roughCut.verbalAdjustSectionCountSuffix")}
                  </span>
                </button>
                {verbalAdjustOpen ? (
                  <div className="mt-1.5 flex flex-col gap-2">
                  <ul className="flex flex-col gap-1.5">
                    {ticAggRows.map((row) => {
                      const dismissId = `tic:${row.coreKey}`;
                      const rowDismissed = dismissedRoughKeys.has(dismissId);
                      const orderedTicIds = orderWordIdsByTranscript(
                        [...row.activeIds, ...row.excludedIds],
                        words
                      );
                      const total = row.activeIds.length + row.excludedIds.length;
                      const wordStruck = row.activeIds.length === 0 && row.excludedIds.length > 0;
                      const canCutOrRestore = row.activeIds.length > 0 || row.excludedIds.length > 0;
                      const scissorsIsRestore = row.activeIds.length === 0 && row.excludedIds.length > 0;
                      return (
                        <li
                          key={dismissId}
                          title={t("presto.flow.roughCut.ticRowTitle").replace("{n}", String(total))}
                          className={[
                            "flex items-center gap-2 rounded-lg border border-line/80 bg-surface/70 px-2 py-1.5 text-[11px]",
                            rowDismissed ? "opacity-55 line-through decoration-ink/45" : ""
                          ].join(" ")}
                        >
                          <span className="shrink-0 rounded bg-rose-500/15 px-1 py-px text-[9px] font-semibold text-rose-800 dark:text-rose-100">
                            {t("presto.flow.roughCut.badgeTic")}
                          </span>
                          <div className="min-w-0 flex-1 truncate font-medium text-ink">
                            <button
                              type="button"
                              disabled={orderedTicIds.length === 0 || !onJumpWord}
                              title={t("presto.flow.roughCut.ticClickJumpTip")}
                              className={[
                                "max-w-full truncate text-left transition hover:text-brand",
                                orderedTicIds.length === 0 || !onJumpWord ? "pointer-events-none opacity-40" : "cursor-pointer",
                                wordStruck && !rowDismissed ? "text-muted line-through decoration-ink/40" : ""
                              ].join(" ")}
                              onClick={() => jumpVerbalRow(dismissId, orderedTicIds)}
                            >
                              {row.label}
                              <span className="ml-1 font-normal text-muted">
                                ×{row.activeIds.length}
                                {row.excludedIds.length > 0 ? (
                                  <span className="text-muted/90">
                                    {" "}
                                    {t("presto.flow.roughCut.ticExcludedCount")
                                      .replace("{n}", String(row.excludedIds.length))}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              disabled={!canCutOrRestore}
                              className={iconBtnClass(!canCutOrRestore)}
                              title={
                                scissorsIsRestore
                                  ? t("presto.flow.roughCut.iconRestoreTip")
                                  : t("presto.flow.roughCut.iconCutTip")
                              }
                              aria-label={
                                scissorsIsRestore
                                  ? t("presto.flow.roughCut.iconRestoreTip")
                                  : t("presto.flow.roughCut.iconCutTip")
                              }
                              onClick={() => {
                                if (row.activeIds.length) onMarkExcluded(row.activeIds);
                                else if (row.excludedIds.length) onMarkRestored(row.excludedIds);
                              }}
                            >
                              <Scissors className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={iconBtnClass()}
                              title={t("presto.flow.roughCut.iconTicDismissToggleTip")}
                              aria-label={t("presto.flow.roughCut.iconTicDismissToggleTip")}
                              onClick={() => onToggleDismissRoughKey(dismissId)}
                            >
                              <CircleX className="h-3.5 w-3.5 text-muted" aria-hidden />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {roughCutSuggestions.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {roughCutSuggestions.map((s) => {
                  const primary = suggestionPrimaryLine(s, words);
                  const ex = s.execute;
                  const rowDismissed = dismissedRoughKeys.has(s.id);
                  const jumpId = s.wordId ?? (ex?.kind === "excludeWords" || ex?.kind === "keepStutterFirst" ? ex.wordIds[0] : undefined) ?? null;
                  const orderedJumpIds =
                    ex?.kind === "excludeWords" || ex?.kind === "keepStutterFirst"
                      ? orderWordIdsByTranscript(ex.wordIds, words)
                      : jumpId
                        ? [jumpId]
                        : [];
                  const toggleIds =
                    ex?.kind === "excludeWords"
                      ? ex.wordIds
                      : ex?.kind === "keepStutterFirst"
                        ? ex.wordIds.slice(1)
                        : [];
                  const activeIds = toggleIds.filter((id) => !excluded.has(id));
                  const excludedIds = toggleIds.filter((id) => excluded.has(id));
                  const canCutOrRestore = toggleIds.length > 0;
                  const scissorsIsRestore = activeIds.length === 0 && excludedIds.length > 0;
                  const wordStruck = scissorsIsRestore && toggleIds.length > 0;
                  const canExpand = Boolean(s.outlineSource && onExpandOutline);
                  const canExecKind = Boolean(ex && (ex.kind === "excludeWords" || ex.kind === "keepStutterFirst"));
                  return (
                    <li
                      key={s.id}
                      title={s.body}
                      className={[
                        "flex items-center gap-2 rounded-lg border border-line/80 bg-surface/70 px-2 py-1.5 text-[11px]",
                        rowDismissed ? "opacity-55 line-through decoration-ink/45" : ""
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "shrink-0 rounded px-1 py-px text-[9px] font-semibold",
                          suggestionBadgeTone(s)
                        ].join(" ")}
                      >
                        {suggestionBadge(s)}
                      </span>
                      {canExpand ? (
                        <button
                          type="button"
                          disabled={outlineExpandBusy}
                          className={iconBtnClass(outlineExpandBusy)}
                          title={t("presto.flow.roughCut.iconExpandTip")}
                          aria-label={t("presto.flow.roughCut.iconExpandTip")}
                          onClick={() => onExpandOutline!(s.outlineSource!)}
                        >
                          <ChevronRight className="h-3.5 w-3.5 text-brand" aria-hidden />
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1 truncate font-medium text-ink">
                        <button
                          type="button"
                          disabled={orderedJumpIds.length === 0 || !onJumpWord}
                          title={t("presto.flow.roughCut.ticClickJumpTip")}
                          className={[
                            "max-w-full truncate text-left text-[11px] transition hover:text-brand",
                            orderedJumpIds.length === 0 || !onJumpWord ? "pointer-events-none opacity-40" : "cursor-pointer",
                            wordStruck && !rowDismissed ? "text-muted line-through decoration-ink/40" : ""
                          ].join(" ")}
                          onClick={() => jumpVerbalRow(`sug:${s.id}`, orderedJumpIds)}
                        >
                          {primary}
                          {toggleIds.length > 0 ? (
                            <span className="ml-1 font-normal text-muted">
                              ×{activeIds.length}
                              {excludedIds.length > 0 ? (
                                <span className="text-muted/90">
                                  {" "}
                                  {t("presto.flow.roughCut.ticExcludedCount").replace("{n}", String(excludedIds.length))}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {canExecKind ? (
                          <button
                            type="button"
                            disabled={!canCutOrRestore}
                            className={iconBtnClass(!canCutOrRestore)}
                            title={
                              scissorsIsRestore
                                ? t("presto.flow.roughCut.iconRestoreTip")
                                : t("presto.flow.roughCut.iconCutTip")
                            }
                            aria-label={
                              scissorsIsRestore
                                ? t("presto.flow.roughCut.iconRestoreTip")
                                : t("presto.flow.roughCut.iconCutTip")
                            }
                            onClick={() => {
                              if (ex?.kind === "excludeWords") {
                                if (activeIds.length) onMarkExcluded(activeIds);
                                else if (excludedIds.length) onMarkRestored(excludedIds);
                              } else if (ex?.kind === "keepStutterFirst") {
                                if (activeIds.length) onExecuteSuggestion(s);
                                else if (excludedIds.length) onMarkRestored(excludedIds);
                              }
                            }}
                          >
                            <Scissors className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={iconBtnClass()}
                          title={t("presto.flow.roughCut.iconTicDismissToggleTip")}
                          aria-label={t("presto.flow.roughCut.iconTicDismissToggleTip")}
                          onClick={() => onToggleDismissRoughKey(s.id)}
                        >
                          <CircleX className="h-3.5 w-3.5 text-muted" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}

                    <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
                      <button
                        type="button"
                        disabled={ticIds.length === 0}
                        className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink shadow-soft hover:bg-fill disabled:opacity-40"
                        onClick={() => onMarkExcluded(ticIds)}
                      >
                        {t("presto.flow.roughCut.fillerCutAll")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

      </section>

      <section className="rounded-xl border border-line bg-fill/30 p-3">
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded-lg border border-line/60 bg-surface/50 px-2 py-1.5 text-left text-[11px] font-semibold text-ink transition hover:bg-fill"
          aria-expanded={pauseSectionOpen}
          onClick={() => setPauseSectionOpen((o) => !o)}
        >
          {pauseSectionOpen ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          )}
          <span>{t("presto.flow.roughCut.pauseTitle")}</span>
          <span className="ml-auto max-w-[58%] truncate text-right text-[10px] font-normal text-muted">
            {pauseEnabled ? t("presto.flow.roughCut.pauseSectionExportOn") : t("presto.flow.roughCut.pauseSectionExportOff")}
            {" · "}
            {t("presto.flow.roughCut.pauseSectionSilences").replace("{n}", String(longSilenceRows.length))}
            {silenceCutCount > 0 ? ` · 已裁 ${silenceCutCount}` : ""}
          </span>
        </button>
        {pauseSectionOpen ? (
          <div className="mt-2">
            {onRefreshSilences ? (
              <button
                type="button"
                disabled={silenceBusy}
                className="mt-1 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-fill disabled:opacity-40"
                onClick={() => void refreshSilencesClick()}
              >
                {silenceBusy ? "…" : t("presto.flow.roughCut.pauseRefreshSilences")}
              </button>
            ) : null}
            {longSilenceRows.length > 0 ? (
              <ul className="mt-2 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
                {longSilenceRows.map((r) => {
                  const sk = silenceRowKey(r.start, r.end);
                  const bridge = silenceBridgeLabel(words, r.start, r.end, excluded);
                  const jumpId = firstWordIdAtOrAfterMs(words, r.end, excluded);
                  const rowDismissed = dismissedRoughKeys.has(sk);
                  const scissorsIsRestore = Boolean(silenceCutKeys?.has(sk));
                  return (
                    <li
                      key={sk}
                      title={bridge}
                      className={[
                        "flex items-center gap-2 rounded-lg border border-line/80 bg-surface/70 px-2 py-1.5 text-[10px]",
                        rowDismissed ? "opacity-55 line-through decoration-ink/45" : ""
                      ].join(" ")}
                    >
                      <span className="shrink-0 rounded bg-sky-500/15 px-1 py-px text-[9px] font-semibold text-sky-900 dark:text-sky-100">
                        {t("presto.flow.roughCut.pauseSilenceBadge")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          disabled={(!jumpId || !onJumpWord) && !onSeekPreviewMs}
                          title={t("presto.flow.roughCut.pauseSilenceJumpTip")}
                          className={[
                            "w-full truncate text-left font-mono text-[10px] text-muted transition hover:text-brand",
                            (!jumpId || !onJumpWord) && !onSeekPreviewMs ? "pointer-events-none opacity-40" : "",
                            scissorsIsRestore ? "line-through decoration-ink/50" : ""
                          ].join(" ")}
                          onClick={() => {
                            if (jumpId && onJumpWord) onJumpWord(jumpId);
                            onSeekPreviewMs?.(r.end + 1);
                          }}
                        >
                          {formatMs(r.start)} – {formatMs(r.end)} · {Math.round(r.dur / 100) / 10}s
                          <span className="mt-0.5 block truncate font-sans text-[10px] font-normal text-ink/90">
                            {bridge}
                          </span>
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          disabled={!onSetSilenceCapMs}
                          className={iconBtnClass(!onSetSilenceCapMs)}
                          title={t("presto.flow.roughCut.pauseSilenceScissorsOnTip")}
                          aria-label={t("presto.flow.roughCut.pauseSilenceScissorsOnTip")}
                          onClick={() => onSetSilenceCapMs?.(r.start, r.end, 200)}
                        >
                          <span className="text-[9px] font-semibold">200</span>
                        </button>
                        <button
                          type="button"
                          disabled={!onSetSilenceCapMs}
                          className={iconBtnClass(!onSetSilenceCapMs)}
                          title={t("presto.flow.roughCut.pauseSilenceScissorsOnTip")}
                          aria-label={t("presto.flow.roughCut.pauseSilenceScissorsOnTip")}
                          onClick={() => onSetSilenceCapMs?.(r.start, r.end, 300)}
                        >
                          <span className="text-[9px] font-semibold">300</span>
                        </button>
                        <button
                          type="button"
                          disabled={!onSetSilenceCapMs}
                          className={iconBtnClass(!onSetSilenceCapMs)}
                          title={t("presto.flow.roughCut.pauseSilenceScissorsOnTip")}
                          aria-label={t("presto.flow.roughCut.pauseSilenceScissorsOnTip")}
                          onClick={() => onSetSilenceCapMs?.(r.start, r.end, 500)}
                        >
                          <span className="text-[9px] font-semibold">500</span>
                        </button>
                        <button
                          type="button"
                          disabled={pauseBusy || !onToggleSilenceCut}
                          className={iconBtnClass(pauseBusy || !onToggleSilenceCut)}
                          title={
                            scissorsIsRestore
                              ? t("presto.flow.roughCut.iconRestoreTip")
                              : t("presto.flow.roughCut.iconCutTip")
                          }
                          aria-label={
                            scissorsIsRestore
                              ? t("presto.flow.roughCut.iconRestoreTip")
                              : t("presto.flow.roughCut.iconCutTip")
                          }
                          onClick={() => onToggleSilenceCut?.(r.start, r.end)}
                        >
                          <Scissors className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={iconBtnClass()}
                          title={t("presto.flow.roughCut.iconTicDismissToggleTip")}
                          aria-label={t("presto.flow.roughCut.iconTicDismissToggleTip")}
                          onClick={() => onToggleDismissRoughKey(sk)}
                        >
                          <CircleX className="h-3.5 w-3.5 text-muted" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[10px] text-muted">{t("presto.flow.roughCut.pauseNoLongSilences")}</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-brand/90">{t("presto.flow.roughCut.pauseAdvice")}</p>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-[10px] text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={pauseEnabled}
                disabled={pauseBusy}
                onChange={(e) => {
                  void savePausePolicy(
                    e.target.checked ? { enabled: true, long_gap_ms: 2000, cap_ms: 500 } : null
                  );
                }}
              />
              <span>{t("presto.flow.roughCut.pauseToggle")}</span>
            </label>
            {pauseEnabled ? (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] leading-relaxed text-brand/95">{t("presto.flow.roughCut.pauseHintExport")}</p>
                {transcriptionSucceeded && hasServerAudio && onGenerateWordchainPreview ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={wordchainPreviewBusy || pauseBusy}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[10px] font-semibold text-ink shadow-soft hover:bg-fill disabled:pointer-events-none disabled:opacity-45"
                      onClick={() => void onGenerateWordchainPreview()}
                    >
                      {wordchainPreviewBusy ? "…" : t("presto.flow.roughCut.wordchainPreviewGenerate")}
                    </button>
                    {wordchainPreviewActive && onExitWordchainPreview ? (
                      <button
                        type="button"
                        className="rounded-lg border border-line bg-fill px-2.5 py-1.5 text-[10px] font-semibold text-ink hover:bg-fill/80"
                        onClick={() => onExitWordchainPreview()}
                      >
                        {t("presto.flow.roughCut.wordchainPreviewExit")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
