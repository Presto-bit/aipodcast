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
  exemptCores: ReadonlySet<string>;
  silenceSegments: readonly ClipSilenceSegment[] | null;
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
  exemptCores,
  silenceSegments,
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
  onExitWordchainPreview
}: Props) {
  const { t } = useI18n();
  const [pauseBusy, setPauseBusy] = useState(false);
  const [tablesBusy, setTablesBusy] = useState(false);
  const [silenceBusy, setSilenceBusy] = useState(false);
  const [tablesDirty, setTablesDirty] = useState(false);
  /** 口癖调整 / 豁免表 / 缩短停顿：侧栏分区默认折叠 */
  const [verbalAdjustOpen, setVerbalAdjustOpen] = useState(false);
  const [exemptSectionOpen, setExemptSectionOpen] = useState(false);
  const [pauseSectionOpen, setPauseSectionOpen] = useState(false);
  /** 口癖行 / 建议行：重复点击同一行时按转写顺序轮换跳转的词 */
  const verbalJumpCycleRef = useRef<Record<string, number>>({});

  useEffect(() => {
    verbalJumpCycleRef.current = {};
  }, [projectId]);

  const serverLexLines = useMemo(() => {
    const arr = Array.isArray(project.rough_cut_lexicon_exempt) ? project.rough_cut_lexicon_exempt : [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  }, [project.rough_cut_lexicon_exempt]);

  const serverHotLines = useMemo(() => {
    const arr = Array.isArray(project.asr_corpus_hotwords) ? project.asr_corpus_hotwords : [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  }, [project.asr_corpus_hotwords]);

  const serverExemptConfigText = useMemo(() => {
    const lines = new Set<string>();
    for (const x of serverLexLines) lines.add(x);
    for (const x of serverHotLines) lines.add(x);
    return [...lines].join("\n");
  }, [serverLexLines, serverHotLines]);

  const [exemptDraft, setExemptDraft] = useState(serverExemptConfigText);

  useEffect(() => {
    setTablesDirty(false);
  }, [projectId]);

  useEffect(() => {
    if (!tablesDirty) setExemptDraft(serverExemptConfigText);
  }, [serverExemptConfigText, tablesDirty]);

  const pausePolicy = project.export_pause_policy;
  const pauseEnabled = Boolean(pausePolicy?.enabled);
  const longGapMs = pauseEnabled ? Math.max(500, Number(pausePolicy?.long_gap_ms) || 2000) : 2500;

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


  const ticIds = useMemo(
    () => collectVerbalTicWordIds(words, excluded, exemptCores),
    [words, excluded, exemptCores]
  );
  const ticAggRows = useMemo(
    () => aggregateVerbalTicRows(words, excluded, exemptCores, 20),
    [words, excluded, exemptCores]
  );

  const hasVerbalAdjust = ticAggRows.length > 0 || roughCutSuggestions.length > 0;

  const suggestionBadge = useCallback(
    (s: ClipEditSuggestion) => {
      if (s.source === "llm") return t("presto.flow.roughCut.badgeAi");
      if (s.id.startsWith("stutter-")) return t("presto.flow.roughCut.badgeStutter");
      return t("presto.flow.roughCut.badgeRule");
    },
    [t]
  );

  const suggestionBadgeTone = useCallback((s: ClipEditSuggestion) => {
    if (s.source === "llm") return "bg-brand/12 text-brand dark:text-brand";
    if (s.id.startsWith("stutter-")) return "bg-amber-500/15 text-amber-900 dark:text-amber-100";
    return "bg-fill text-muted";
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

  const saveExemptConfig = useCallback(async () => {
    setTablesBusy(true);
    onError("");
    const lines = exemptDraft
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          rough_cut_lexicon_exempt: lines,
          asr_corpus_hotwords: lines
        })
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
      setTablesDirty(false);
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setTablesBusy(false);
    }
  }, [exemptDraft, getAuthHeaders, onError, onProjectPatch, onRefreshProject, projectId]);

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

  const exemptNonEmptyLineCount = useMemo(
    () => exemptDraft.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length,
    [exemptDraft]
  );

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
          aria-expanded={exemptSectionOpen}
          onClick={() => setExemptSectionOpen((o) => !o)}
        >
          {exemptSectionOpen ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          )}
          <span>{t("presto.flow.roughCut.exemptConfigTitle")}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-normal text-muted">
            {tablesDirty && !exemptSectionOpen ? (
              <span className="text-amber-700 dark:text-amber-300">{t("presto.flow.roughCut.lexCorpusDirty")}</span>
            ) : null}
            <span>
              {exemptNonEmptyLineCount}
              {t("presto.flow.roughCut.exemptSectionCountSuffix")}
            </span>
          </span>
        </button>
        {exemptSectionOpen ? (
          <div className="mt-2">
            <textarea
              value={exemptDraft}
              disabled={tablesBusy}
              onChange={(e) => {
                setTablesDirty(true);
                setExemptDraft(e.target.value);
              }}
              rows={5}
              spellCheck={false}
              className="mt-2 w-full resize-y rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-[11px] leading-snug text-ink placeholder:text-muted"
              placeholder={t("presto.flow.roughCut.exemptConfigPlaceholder")}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={tablesBusy}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[10px] font-semibold text-ink shadow-soft hover:bg-fill disabled:opacity-40"
                onClick={() => void saveExemptConfig()}
              >
                {tablesBusy ? "…" : t("presto.flow.roughCut.exemptConfigSave")}
              </button>
              {tablesDirty ? <span className="text-[10px] text-muted">{t("presto.flow.roughCut.lexCorpusDirty")}</span> : null}
            </div>
          </div>
        ) : null}
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
