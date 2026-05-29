"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBearerAuthHeadersSync } from "../../lib/authHeaders";
import { useAppNotice } from "../../lib/AppNoticeContext";
import SmallConfirmModal from "../ui/SmallConfirmModal";
import { WorkHubManuscriptPreview } from "./WorkHubManuscriptPreview";

const SCRIPT_AUTOSAVE_MS = 750;

type Props = {
  jobId: string;
  manuscriptBody: string;
  /** 只读预览用正文（可与保存稿不同，如自媒体稿补全话题标签） */
  previewBody?: string;
  scriptResolvePending: boolean;
  onManuscriptSaved: (next: string) => void | Promise<void>;
  canEditScript: boolean;
  /** 播客成片：在当前页按原 payload 仅重跑语音合成 */
  regenerateVoiceSupported: boolean;
  regenerateVoiceBusy: boolean;
  onRegenerateVoice?: () => void;
  /** 纯文稿作品详情：正文区高度加倍，并隐藏「保存后写入…」说明 */
  pureManuscriptOnly?: boolean;
  /** 工具栏由父级（如章节标题行）渲染 */
  hideToolbar?: boolean;
  /** 口播稿：输入停顿后自动保存（无「保存」按钮） */
  scriptAutosave?: boolean;
  /** 递增时打开「清空口播稿」确认框（供外部工具栏触发删除） */
  requestDelete?: number;
  /** 只读且无正文时替代「（无正文）」（如生成中占位） */
  readonlyEmptyHint?: string;
  /** 播客详情：拉高口播稿区域高度（与章节时间轴列表二选一展示时使用） */
  tallScriptArea?: boolean;
  /**
   * 章节口播：`hideToolbar` + `scriptAutosave` 时为 false 则只读预览；true 时为编辑态（仅一处正文）。
   */
  chapterEditorOpen?: boolean;
  /** false 时正文区不限高，由父级容器统一滚动（如自媒体稿含标题/配图建议） */
  innerScroll?: boolean;
};

export function WorkHubManuscriptBar({
  jobId,
  manuscriptBody,
  previewBody,
  scriptResolvePending,
  onManuscriptSaved,
  canEditScript,
  regenerateVoiceSupported,
  regenerateVoiceBusy,
  onRegenerateVoice,
  pureManuscriptOnly = false,
  hideToolbar = false,
  scriptAutosave = false,
  requestDelete = 0,
  chapterEditorOpen,
  readonlyEmptyHint,
  tallScriptArea = false,
  innerScroll = true
}: Props) {
  const { showError } = useAppNotice();
  const [draft, setDraft] = useState(manuscriptBody);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "err">("idle");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestDeletePrevRef = useRef(0);

  useEffect(() => {
    setDraft(manuscriptBody);
  }, [manuscriptBody]);

  const chapterCollapsed =
    hideToolbar && scriptAutosave && canEditScript && chapterEditorOpen === false;

  const prevChapterEditorOpenRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!hideToolbar || !scriptAutosave) return;
    const wasOpen = prevChapterEditorOpenRef.current === true;
    prevChapterEditorOpenRef.current = chapterEditorOpen === true;
    if (chapterEditorOpen === true && !wasOpen) {
      setDraft(manuscriptBody);
      setErr(null);
    }
  }, [chapterEditorOpen, manuscriptBody, hideToolbar, scriptAutosave]);

  useEffect(() => {
    if (!requestDelete || requestDelete === requestDeletePrevRef.current) return;
    requestDeletePrevRef.current = requestDelete;
    setErr(null);
    setDeleteErr(null);
    setDeleteOpen(true);
  }, [requestDelete]);

  const dirty = canEditScript && draft !== manuscriptBody;

  const persistDraft = useCallback(
    async (text: string) => {
      if (!canEditScript) return;
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/result-script`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getBearerAuthHeadersSync() },
          body: JSON.stringify({ script_text: text })
        });
        if (!res.ok) {
          const tx = await res.text().catch(() => "");
          throw new Error(tx || `HTTP ${res.status}`);
        }
        await onManuscriptSaved(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        if (scriptAutosave) setAutosaveStatus("err");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [canEditScript, jobId, onManuscriptSaved, scriptAutosave]
  );

  const saveDraft = useCallback(async () => {
    if (!canEditScript) return;
    await persistDraft(draft);
  }, [canEditScript, draft, persistDraft]);

  useEffect(() => {
    if (!scriptAutosave || !canEditScript || chapterCollapsed) return;
    if (draft === manuscriptBody) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setAutosaveStatus((s) => (s === "saved" ? s : "idle"));
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void (async () => {
        setAutosaveStatus("saving");
        try {
          await persistDraft(draft);
          setAutosaveStatus("saved");
          if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
          savedFlashTimerRef.current = setTimeout(() => {
            savedFlashTimerRef.current = null;
            setAutosaveStatus("idle");
          }, 2000);
        } catch {
          /* err already set */
        }
      })();
    }, SCRIPT_AUTOSAVE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [draft, manuscriptBody, scriptAutosave, canEditScript, persistDraft, chapterCollapsed]);

  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
    };
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!canEditScript) return;
    setBusy(true);
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/result-script`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getBearerAuthHeadersSync() },
        body: JSON.stringify({ script_text: "" })
      });
      if (!res.ok) {
        const tx = await res.text().catch(() => "");
        throw new Error(tx || `HTTP ${res.status}`);
      }
      await onManuscriptSaved("");
      setDeleteOpen(false);
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [canEditScript, jobId, onManuscriptSaved]);

  const copyAll = useCallback(async () => {
    const t = manuscriptBody.trim();
    if (!t) {
      showError("暂无可复制的正文。");
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      showError("复制失败，请检查浏览器是否允许本站访问剪贴板。");
    }
  }, [manuscriptBody, showError]);

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-2">
        {!hideToolbar ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={scriptResolvePending}
              onClick={() => void copyAll()}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill disabled:opacity-40"
            >
              复制
            </button>
            {regenerateVoiceSupported ? (
              <button
                type="button"
                disabled={
                  regenerateVoiceBusy ||
                  scriptResolvePending ||
                  !manuscriptBody.trim() ||
                  !onRegenerateVoice
                }
                onClick={() => onRegenerateVoice?.()}
                className="rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/15 disabled:opacity-40"
              >
                {regenerateVoiceBusy ? "合成中…" : "重新合成语音"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canEditScript || scriptResolvePending}
              onClick={() => {
                setErr(null);
                setDeleteErr(null);
                setDeleteOpen(true);
              }}
              className="rounded-lg border border-danger/35 bg-danger-soft/40 px-2 py-1 text-[11px] font-medium text-danger-ink hover:bg-danger-soft/70 disabled:opacity-40"
            >
              删除
            </button>
          </div>
        ) : null}

        {canEditScript && !chapterCollapsed ? (
          <div className="min-w-0 space-y-1.5">
            <textarea
              className={
                pureManuscriptOnly
                  ? innerScroll
                    ? "max-h-[min(110vh,56rem)] min-h-[24rem] w-full rounded-lg border border-line bg-fill/30 p-3 [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm"
                    : "min-h-[24rem] w-full rounded-lg border border-line bg-fill/30 p-3 [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm"
                  : tallScriptArea
                    ? "max-h-[min(92vh,56rem)] min-h-[min(52vh,28rem)] w-full rounded-lg border border-line bg-fill/30 p-3 [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm"
                    : "max-h-[min(55vh,28rem)] min-h-[12rem] w-full rounded-lg border border-line bg-fill/30 p-3 [font-family:var(--dawn-font-sans)] text-[13px] leading-relaxed text-ink sm:text-sm"
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy || scriptResolvePending}
              spellCheck={false}
              aria-label="口播稿正文"
            />
            {!pureManuscriptOnly ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-muted/90">
                    {scriptAutosave
                      ? autosaveStatus === "saving"
                        ? "保存中…"
                        : autosaveStatus === "saved"
                          ? "已保存"
                          : autosaveStatus === "err"
                            ? "自动保存失败，请检查网络"
                            : "编辑内容会自动保存"
                      : "保存后写入作品结果；简介与 Shownotes 不会自动重写。"}
                  </p>
                  {!scriptAutosave ? (
                    <button
                      type="button"
                      disabled={busy || scriptResolvePending || !dirty}
                      onClick={() => void saveDraft()}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-95 disabled:opacity-40"
                    >
                      {busy ? "保存中…" : "保存"}
                    </button>
                  ) : null}
                </div>
                {err && (!scriptAutosave || autosaveStatus === "err") ? (
                  <p className="text-xs text-danger-ink">{err}</p>
                ) : null}
              </>
            ) : (
              <>
                {err ? <p className="text-xs text-danger-ink">{err}</p> : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy || scriptResolvePending || !dirty}
                    onClick={() => void saveDraft()}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-95 disabled:opacity-40"
                  >
                    {busy ? "保存中…" : "保存"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <WorkHubManuscriptPreview
            body={previewBody ?? manuscriptBody}
            emptyHint={readonlyEmptyHint}
            scrollContained={innerScroll}
            className={
              innerScroll
                ? pureManuscriptOnly
                  ? "max-h-[min(80vh,36rem)]"
                  : tallScriptArea
                    ? "min-h-[min(56vh,30rem)] max-h-[min(92vh,56rem)]"
                    : "max-h-[min(40vh,18rem)]"
                : ""
            }
          />
        )}
      </div>

      <SmallConfirmModal
        open={deleteOpen}
        title="清空口播稿"
        message="确定清空正文？建议先复制备份。"
        confirmLabel="清空"
        cancelLabel="取消"
        danger
        busy={busy}
        busyLabel="处理中…"
        error={deleteErr}
        onCancel={() => {
          if (busy) return;
          setDeleteOpen(false);
          setDeleteErr(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
