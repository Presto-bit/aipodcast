"use client";

import dynamic from "next/dynamic";
import type { Ref } from "react";
import EmptyState from "../ui/EmptyState";
import InlineTextPrompt from "../ui/InlineTextPrompt";
import UserErrorBanner from "../ui/UserErrorBanner";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import {
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconPencil,
  IconSourcesBinder,
  IconSparkle,
  IconStopSquare,
  IconWorkPodcast,
  IconWorkScript
} from "../icons";
import NotebookWorkbenchHeader from "./NotebookWorkbenchHeader";
import NotebookStyleSourcesNotice from "./NotebookStyleSourcesNotice";
import { NotebookStyleHeaderChip } from "./notebook-style/NotebookStyleControls";
import {
  buildNotesAskAnswerBody,
  isDismissedNotesAskSupplement
} from "../../lib/notesAskAnswerNormalize";
import {
  NOTES_ASK_DEBUG_BODY_ENABLED,
  NOTES_ASK_HINTS_BOOT_PREFIX,
  NOTES_ASK_SOURCE_REQUIRED
} from "./notesWorkbenchConstants";
import { useNotesWorkbench } from "./notesWorkbenchContext";

const NotebookStyleControls = dynamic(
  () =>
    import("./notebook-style/NotebookStyleControls").then((m) => ({
      default: m.NotebookStyleControls
    })),
  { ssr: false }
);
const NotesWorkbenchWorksPanel = dynamic(
  () => import("../works/NotesWorkbenchWorksPanel"),
  {
    loading: () => (
      <div
        className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
        aria-busy
        aria-label="加载作品列表"
      />
    )
  }
);
const NotesAskAnswerDisplay = dynamic(
  () => import("./NotesAskAnswerDisplay").then((m) => ({ default: m.NotesAskAnswerDisplay })),
  { ssr: false }
);
const NotesAskStreamingStatus = dynamic(
  () => import("./NotesAskStreamingStatus").then((m) => ({ default: m.NotesAskStreamingStatus })),
  { ssr: false }
);
const NotesAskDialogueStylePicker = dynamic(() => import("./NotesAskDialogueStylePicker"), {
  ssr: false
});

const WORKBENCH_SECTION_TITLE = "text-base font-semibold tracking-tight text-ink";
const WORKBENCH_PANEL_STICKY_HEAD =
  "sticky top-0 z-30 -mx-4 border-b border-line/50 bg-fill/95 px-4 backdrop-blur-sm supports-[backdrop-filter]:bg-fill/90";

export default function NotesWorkbenchView() {
  const w = useNotesWorkbench();
  const {
    router,
    userPrefersNotebookHubRef,
    selectedNotebook,
    notebooks,
    notebookVisualByName,
    sharedBrowse,
    dismissNotesBlockingOverlays,
    setHubView,
    setSelectedNotebook,
    setSharedBrowse,
    openNotebook,
    setNotebookModalError,
    setNewNotebookName,
    setShowNotebookModal,
    workbenchMobilePanel,
    setWorkbenchMobilePanel,
    draftSelectedNoteIds,
    sourcesPanelCollapsed,
    setSourcesPanelCollapsed,
    styleNoteMetas,
    setNotebookStyleItem,
    setStyleActionToast,
    setError,
    notebookStyleItem,
    setShowAddNoteModal,
    setImportUrlError,
    styleActionToast,
    stats,
    hasMoreNotes,
    notesSorted,
    selectAllOnPageInputRef,
    allNotesOnPageSelected,
    onSelectAllOnPageChange,
    loading,
    isSourceUsable,
    openPreview,
    noteExtLabel,
    freshNoteIds,
    isNoteInStyleSnapshot,
    noteMenuOpenId,
    setNoteMenuOpenId,
    setRenameNoteId,
    setRenameNoteTitle,
    confirmDeleteNote,
    toggleDraftNote,
    renameNoteId,
    renameNoteTitle,
    saveRenameNote,
    renameDebugLog,
    notePage,
    setNotePage,
    notesAskMenuOpen,
    setNotesAskMenuOpen,
    podcastGenBusy,
    openPodcastFlow,
    openArticleFlow,
    notesAskMessages,
    clearNotesAskConversation,
    notesAskError,
    setNotesAskError,
    notesAskScrollRef,
    notesAskLastUserMessageId,
    copyNotesAskAnswer,
    beginEditNotesAskUserTurn,
    openPreviewFromAskSource,
    setNotesAskQuestion,
    notesAskTextareaRef,
    notesAskNoteBusyId,
    saveAskAnswerAsNote,
    notebookDigestSummary,
    notesAskQuestion,
    notesAskBusy,
    submitNotesAsk,
    notesAskDialogueStyle,
    setNotesAskDialogueStyle,
    notebookStylePrompt,
    scrollToNotebookStyleLearn,
    notesAskStreamAbortRef,
    notesAskDebugClient,
    notesAskDebugPack,
    notesAskDebugCurls,
    notesAskDebugCopied,
    copyNotesAskDebug,
    notesWorkbenchCreationProgress,
    worksPanelExpanded,
    setWorksPanelExpanded,
    notesWorksViewAllHref,
    podcastWorks,
    podcastWorksLoading,
    podcastWorksError,
    setPodcastWorksError,
    fetchPodcastWorks,
    notesPendingStudioWork,
    notesPendingStudioSubtitle
  } = w;

  return (
<div className="mx-auto w-full max-w-[min(100%,1800px)] px-3 sm:px-4">
  <NotebookWorkbenchHeader
    selectedNotebook={selectedNotebook}
    notebooks={notebooks}
    notebookVisualByName={notebookVisualByName}
    sharedBrowse={sharedBrowse}
    onBackToHub={() => {
      userPrefersNotebookHubRef.current = true;
      setSharedBrowse(null);
      dismissNotesBlockingOverlays();
      setHubView(true);
      setSelectedNotebook("");
      router.push("/notes");
    }}
    onOpenNotebook={openNotebook}
    onNewNotebook={() => {
      setNotebookModalError("");
      setNewNotebookName("");
      setShowNotebookModal(true);
    }}
  />

  <div
    className="mb-3 flex gap-1 rounded-xl border border-line/60 bg-fill/35 p-1 lg:hidden"
    role="tablist"
    aria-label="工作台分区"
  >
    <button
      type="button"
      role="tab"
      aria-selected={workbenchMobilePanel === "chat"}
      className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
        workbenchMobilePanel === "chat"
          ? "border-brand/40 bg-surface text-ink shadow-sm ring-1 ring-brand/20"
          : "border-transparent text-muted hover:bg-fill/50"
      }`}
      onClick={() => setWorkbenchMobilePanel("chat")}
    >
      对话
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={workbenchMobilePanel === "sources"}
      className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
        workbenchMobilePanel === "sources"
          ? "border-brand/40 bg-surface text-ink shadow-sm ring-1 ring-brand/20"
          : "border-transparent text-muted hover:bg-fill/50"
      }`}
      onClick={() => setWorkbenchMobilePanel("sources")}
    >
      参考资料
      {draftSelectedNoteIds.length > 0 ? (
        <span className="ml-1 tabular-nums text-muted">({draftSelectedNoteIds.length})</span>
      ) : null}
    </button>
  </div>

  <div className="flex min-w-0 w-full flex-col gap-3">
  <div className="flex min-h-0 flex-col gap-3 max-lg:min-h-[calc(100dvh-10.5rem)] lg:h-[min(100dvh-5.5rem,900px)] lg:max-h-[min(100dvh-5.5rem,900px)] lg:flex-row lg:items-stretch lg:gap-3 lg:overflow-hidden">
    <section
      className={`flex shrink-0 flex-col overflow-hidden rounded-3xl border border-line/70 bg-fill/15 shadow-soft max-lg:min-h-0 max-lg:flex-1 lg:min-h-0 lg:h-full ${
        workbenchMobilePanel !== "sources" ? "max-lg:hidden" : ""
      } ${
        sourcesPanelCollapsed
          ? "w-full lg:w-[3.25rem] lg:min-w-[3.25rem] lg:max-w-[3.25rem] p-2"
          : "w-full p-4 lg:w-[22rem] lg:min-w-[22rem] lg:max-w-[24rem]"
      }`}
      aria-label="参考资料"
    >
      {sourcesPanelCollapsed ? (
        <button
          type="button"
          className="flex w-full flex-1 flex-row items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface/60 lg:min-h-0 lg:flex-col lg:items-center lg:justify-start lg:gap-5 lg:px-1 lg:py-8"
          aria-label="向右展开参考资料"
          title="展开参考资料"
          onClick={() => setSourcesPanelCollapsed(false)}
        >
          <IconSourcesBinder width={20} height={20} className="shrink-0 text-muted" aria-hidden />
          <span className="text-sm font-semibold text-ink lg:text-xs lg:[writing-mode:vertical-rl]">参考资料</span>
          <IconChevronRight width={18} height={18} className="shrink-0 text-ink" aria-hidden />
        </button>
      ) : (
        <NotebookStyleControls
          notebookName={selectedNotebook}
          selectedNoteIds={draftSelectedNoteIds}
          noteMetas={styleNoteMetas}
          readOnly={sharedBrowse?.access === "read_only"}
          disabled={notebooks.length === 0}
          onItemChange={setNotebookStyleItem}
          onToast={setStyleActionToast}
          onError={setError}
        >
        <>
          {notebooks.length === 0 ? (
            <div className="mb-3 shrink-0 rounded-xl border border-brand/35 bg-gradient-to-br from-brand/[0.08] to-brand/[0.06] px-3 py-3 shadow-soft ring-1 ring-brand/10">
              <p className="text-xs font-semibold text-ink">新建笔记本</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">创建后可添加资料并在右侧使用。</p>
              <button
                type="button"
                className="mt-2.5 w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground shadow-soft transition-opacity hover:opacity-95"
                onClick={() => {
                  setNotebookModalError("");
                  setNewNotebookName("");
                  setShowNotebookModal(true);
                }}
              >
                新建笔记本
              </button>
            </div>
          ) : null}
          <div
            className={`${WORKBENCH_PANEL_STICKY_HEAD} flex shrink-0 items-center justify-between gap-2 pb-3`}
          >
            <h2 className={`min-w-0 flex-1 truncate ${WORKBENCH_SECTION_TITLE}`}>
              参考资料
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              <NotebookStyleHeaderChip />
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface/80 hover:text-ink"
                aria-expanded
                aria-label="收起参考资料（向左折叠）"
                title="向左收起"
                onClick={() => setSourcesPanelCollapsed(true)}
              >
                <IconChevronLeft width={18} height={18} aria-hidden />
              </button>
            </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            disabled={notebooks.length === 0 || Boolean(sharedBrowse)}
            title={
              sharedBrowse
                ? "分享浏览模式下不可添加资料"
                : notebooks.length === 0
                  ? "请先新建笔记本"
                  : undefined
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line/90 bg-surface py-2.5 text-sm font-medium text-ink shadow-soft transition-colors hover:border-brand/35 hover:bg-fill/50 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => {
              setImportUrlError("");
              setShowAddNoteModal(true);
            }}
          >
            <span className="text-base leading-none text-brand">+</span>
            添加资料
          </button>
        </div>
        <NotebookStyleSourcesNotice actionToast={styleActionToast} />

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] leading-snug text-muted">
            {notebooks.length === 0
              ? "创建笔记本后即可添加资料。"
              : `已选 ${draftSelectedNoteIds.length} 条 · 本页 ${stats.total} 条${hasMoreNotes ? " · 仍有更多" : ""}`}
          </p>
        </div>
        {notesSorted.length > 0 ? (
          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-ink hover:bg-surface/70">
            <input
              ref={selectAllOnPageInputRef}
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={allNotesOnPageSelected}
              onChange={onSelectAllOnPageChange}
              aria-label="选择全部"
            />
            选择全部
          </label>
        ) : null}
        {loading ? <p className="mt-2 text-sm text-muted">加载中…</p> : null}
        <div className="mt-2 space-y-1.5">
          {notesSorted.map((n) => (
            (() => {
              const preReady = isSourceUsable(n);
              return (
            <div
              key={n.noteId}
              data-note-id={n.noteId}
              className={`rounded-xl border p-2.5 shadow-soft transition-colors ${
                preReady
                  ? "border-line/80 bg-surface/95"
                  : "border-line/55 bg-fill/35 opacity-80"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className={`min-w-0 truncate text-left text-sm font-medium underline-offset-2 hover:underline ${
                        preReady ? "text-ink" : "text-muted"
                      }`}
                      onClick={() =>
                        void openPreview(n.noteId, { ext: n.ext, inputType: n.inputType })
                      }
                      title="阅读参考资料"
                    >
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <span className="shrink-0 rounded bg-fill px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted">
                          {noteExtLabel(n.ext)}
                        </span>
                        <span className="truncate">{n.title || n.noteId}</span>
                      </span>
                    </button>
                    {(() => {
                      const ps = String(n.parseState || "").trim().toLowerCase();
                      if (ps === "pending" || ps === "parsing") {
                        return (
                          <span
                            className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-brand/12 text-brand"
                            title={n.sourceHint || "正在后台解析正文"}
                          >
                            解析中
                          </span>
                        );
                      }
                      if (n.parseState === "failed" || !isSourceUsable(n)) {
                        return (
                          <span
                            className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-warning-soft text-warning-ink"
                            title={n.sourceHint || "参考资料尚未可用"}
                          >
                            参考资料待就绪
                          </span>
                        );
                      }
                      return null;
                    })()}
                    {n.citeState === "unavailable" ? (
                      <span
                        className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-warning-soft text-warning-ink"
                        title="引用不可用"
                      >
                        引用不可用
                      </span>
                    ) : null}
                    {freshNoteIds.includes(n.noteId) ? (
                      <span
                        className="inline-flex shrink-0 text-warning"
                        title="刚加入，可作播客资料"
                        role="img"
                        aria-label="刚加入的资料"
                      >
                        <IconSparkle width={14} height={14} className="text-brand" />
                      </span>
                    ) : null}
                    {isNoteInStyleSnapshot(n.noteId, notebookStyleItem) ? (
                      <span
                        className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-brand/12 text-brand"
                        title="已纳入最近一次风格提炼"
                      >
                        已纳入风格
                      </span>
                    ) : null}
                    {n.retrieveState === "failed" || n.ragIndexError ? (
                      <span
                        className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-danger-soft text-danger-ink"
                        title={n.ragIndexError || "检索索引失败"}
                      >
                        检索失败
                      </span>
                    ) : null}
                  </div>
                  
                </div>
                <div className="flex shrink-0 items-start gap-0.5">
                  <div className="relative" data-note-overflow-menu>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-track"
                    aria-label="更多"
                    aria-expanded={noteMenuOpenId === n.noteId}
                    onClick={() => setNoteMenuOpenId((x) => (x === n.noteId ? null : n.noteId))}
                  >
                    ⋯
                  </button>
                  {noteMenuOpenId === n.noteId ? (
                    <div className="absolute right-0 top-full z-10 mt-0.5 min-w-[7rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card">
                      {sharedBrowse ? null : (
                        <>
                          <button
                            type="button"
                            className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                            onClick={() => {
                              setRenameNoteId(n.noteId);
                              setRenameNoteTitle(n.title || "");
                              setNoteMenuOpenId(null);
                            }}
                          >
                            改名
                          </button>
                          <button
                            type="button"
                            className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                            onClick={() => {
                              setRenameNoteId(null);
                              setNoteMenuOpenId(null);
                              void confirmDeleteNote(n.noteId);
                            }}
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                  </div>
                  <input
                    type="checkbox"
                    className={`mt-1.5 h-4 w-4 ${preReady ? "accent-brand" : "accent-muted"}`}
                    checked={draftSelectedNoteIds.includes(n.noteId)}
                    onChange={() => toggleDraftNote(n.noteId)}
                    disabled={!preReady}
                    aria-label={`将「${n.title || n.noteId}」纳入资料`}
                  />
                </div>
              </div>
              {renameNoteId === n.noteId ? (
                <div className="mt-2 border-t border-line pt-2">
                  <InlineTextPrompt
                    open
                    title="重命名笔记"
                    value={renameNoteTitle}
                    onChange={setRenameNoteTitle}
                    onSubmit={() => void saveRenameNote(n.noteId)}
                    onCancel={() => setRenameNoteId(null)}
                    className="border-line bg-canvas/80"
                  />
                  {renameDebugLog ? (
                    <pre className="mt-2 max-h-28 overflow-auto rounded border border-line/60 bg-fill/20 p-2 text-[10px] leading-relaxed text-muted">
                      {renameDebugLog}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
              );
            })()
          ))}
          {!loading && notesSorted.length === 0 ? (
            <EmptyState
              title="这个笔记本里还没有笔记"
              description="「添加资料」导入；勾选纳入资料。"
              className="mt-2 border-none bg-transparent py-8"
            />
          ) : null}
          {!loading && (notePage > 1 || hasMoreNotes) ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px]">
              <button
                type="button"
                className="rounded border border-line px-2 py-1 text-ink disabled:opacity-40"
                disabled={notePage <= 1}
                onClick={() => setNotePage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="text-muted">第 {notePage} 页</span>
              <button
                type="button"
                className="rounded border border-line px-2 py-1 text-ink disabled:opacity-40"
                disabled={!hasMoreNotes}
                onClick={() => setNotePage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </div>
      </div>
        </>
        </NotebookStyleControls>
      )}
    </section>

    <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
    <section
      className={`flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-line/70 bg-fill/15 px-4 pb-5 pt-4 shadow-soft max-lg:min-h-0 max-lg:flex-1 max-lg:pb-6 lg:h-full ${
        workbenchMobilePanel !== "chat" ? "max-lg:hidden" : ""
      }`}
      role="region"
      aria-label="对话"
    >
      <div
        className={`${WORKBENCH_PANEL_STICKY_HEAD} flex shrink-0 flex-wrap items-center justify-between gap-2 pb-2`}
      >
        <h2 className={WORKBENCH_SECTION_TITLE}>对话</h2>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={sharedBrowse?.access === "read_only" || podcastGenBusy}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-line/70 bg-surface px-3 text-xs font-medium text-ink transition hover:bg-fill disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => openPodcastFlow()}
          >
            <IconWorkPodcast width={20} height={20} className="shrink-0" aria-hidden />
            <span>{podcastGenBusy ? "生成播客…" : "生成播客"}</span>
          </button>
          <button
            type="button"
            disabled={sharedBrowse?.access === "read_only"}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-line/70 bg-surface px-3 text-xs font-medium text-ink transition hover:bg-fill disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => openArticleFlow()}
          >
            <IconWorkScript width={20} height={20} className="shrink-0" aria-hidden />
            <span>生成文章</span>
          </button>
          <div className="relative" data-notes-ask-overflow-menu>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/70 bg-surface text-lg leading-none text-muted transition hover:bg-fill hover:text-ink"
              aria-label="更多"
              aria-expanded={notesAskMenuOpen}
              title="更多"
              onClick={() => setNotesAskMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {notesAskMenuOpen ? (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[7.5rem] rounded-lg border border-line/80 bg-surface py-1 shadow-card">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-muted hover:bg-fill hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={
                    notesAskMessages.length === 0 &&
                    !notesAskMessages.some((m) => m.streaming)
                  }
                  onClick={() => {
                    setNotesAskMenuOpen(false);
                    clearNotesAskConversation();
                  }}
                >
                  清除对话
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {notesAskError ? (
          <UserErrorBanner
            variant="dense"
            className="shrink-0"
            message={notesAskError}
            onDismiss={() => setNotesAskError("")}
          />
        ) : null}
        <div
          ref={notesAskScrollRef}
          className="min-h-[200px] w-full min-w-0 flex-1 overflow-y-auto py-1"
        >
          {notesAskMessages.length === 0 ? (
            <p className="text-xs text-muted">勾选左侧资料后即可提问</p>
          ) : (
            <div className="flex flex-col gap-3">
              {notesAskMessages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user" ? "flex justify-end" : "flex w-full min-w-0 justify-start"
                  }
                >
                    {m.role === "user" ? (
                      notesAskLastUserMessageId === m.id ? (
                      <div className="group/user-msg flex max-w-[min(96%,28rem)] min-w-0 items-start gap-2">
                        <div className="pointer-events-none flex shrink-0 flex-row items-center gap-0.5 self-start pt-1.5 opacity-0 transition-opacity duration-150 group-hover/user-msg:pointer-events-auto group-hover/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto group-focus-within/user-msg:opacity-100">
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-brand/10 hover:text-ink"
                              title="复制问题"
                              aria-label="复制问题"
                              disabled={!(m.content || "").trim()}
                              onClick={() => void copyNotesAskAnswer(m.content)}
                            >
                              <IconClipboard width={14} height={14} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-brand/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                              title="编辑问题（将中止当前生成并回填输入框）"
                              aria-label="编辑问题"
                              disabled={sharedBrowse?.access === "read_only"}
                              onClick={() => beginEditNotesAskUserTurn(m.id, m.content)}
                            >
                              <IconPencil width={14} height={14} aria-hidden />
                            </button>
                          </div>
                        <div className="min-w-0 flex-1 text-sm text-ink">
                          <p className="min-w-0 whitespace-pre-wrap break-words">{m.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-[min(92%,28rem)] min-w-0 text-sm text-ink">
                        <p className="min-w-0 whitespace-pre-wrap break-words">{m.content}</p>
                      </div>
                    )
                    ) : (
                      <div className="w-full min-w-0 max-w-full px-0 py-1 text-sm leading-relaxed text-ink">
                    {(() => {
                      const corpusOnly = (m.content || "").trim();
                      const hasSupplement =
                        Boolean(m.supplementContent?.trim()) &&
                        !isDismissedNotesAskSupplement(m.supplementContent || "");
                      const displayReady = corpusOnly || hasSupplement;
                      const askBodyForCopy = buildNotesAskAnswerBody(
                        m.content,
                        m.supplementContent
                      );
                      return (
                      <div className="min-w-0 space-y-3">
                        {m.streaming ? (
                          m.streamingPhase ||
                          m.streamingReasoning ||
                          (!corpusOnly && !hasSupplement) ? (
                            <NotesAskStreamingStatus
                              phase={m.streamingPhase}
                              reasoning={m.streamingReasoning}
                              hasAnswer={Boolean(corpusOnly || hasSupplement)}
                            />
                          ) : null
                        ) : null}
                        {displayReady ? (
                        <NotesAskAnswerDisplay
                          text={corpusOnly}
                          supplementContent={m.supplementContent}
                          lowConfidence={m.lowConfidence}
                          sources={m.sources}
                          webSources={m.webSources}
                          followUpQuestion={
                            !m.streaming ? m.followUpQuestions?.[0] : undefined
                          }
                          onFollowUpClick={(q: string) => {
                            setNotesAskQuestion(q);
                            window.setTimeout(
                              () => notesAskTextareaRef.current?.focus(),
                              0
                            );
                          }}
                          onOpenSourceInPreview={openPreviewFromAskSource}
                        />
                        ) : null}
                        {!m.streaming &&
                        m.id.startsWith(NOTES_ASK_HINTS_BOOT_PREFIX) &&
                        (m.hintSuggestions?.length ?? 0) > 0 ? (
                          <div className="mt-2 flex flex-col gap-1.5">
                            <p className="text-[11px] font-medium text-muted">试试这样问（点击填入输入框）</p>
                            <div className="flex flex-wrap gap-1.5">
                              {m.hintSuggestions!.map((q) => (
                                <button
                                  key={q}
                                  type="button"
                                  className="max-w-full rounded-lg border border-brand/35 bg-brand/[0.06] px-2.5 py-1.5 text-left text-[11px] leading-snug text-ink transition hover:bg-brand/10"
                                  title={q}
                                  onClick={() => {
                                    setNotesAskQuestion(q);
                                    window.setTimeout(() => notesAskTextareaRef.current?.focus(), 0);
                                  }}
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {!m.streaming &&
                        askBodyForCopy.trim() &&
                        !m.id.startsWith(NOTES_ASK_HINTS_BOOT_PREFIX) ? (
                          <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line/40 pt-2">
                            <button
                              type="button"
                              className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted hover:bg-fill hover:text-ink"
                              title="复制"
                              aria-label="复制"
                              onClick={() => void copyNotesAskAnswer(askBodyForCopy)}
                            >
                              复制
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted hover:bg-fill hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={Boolean(sharedBrowse) || notesAskNoteBusyId === m.id}
                              onClick={() => void saveAskAnswerAsNote(m.content || "", m.id)}
                            >
                              {notesAskNoteBusyId === m.id ? "加入中…" : "加入资料"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      );
                  })()}
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-auto flex min-w-0 shrink-0 flex-col gap-2 pb-2 pt-2">
          {notebookDigestSummary ? (
            <p className="rounded-lg border border-line/70 bg-fill/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted">
              笔记本综述：{notebookDigestSummary}
            </p>
          ) : null}
          <div
            className={`fym-composer-shell flex shrink-0 items-end gap-2.5 px-3.5 py-2.5 ${
              draftSelectedNoteIds.length === 0 ? "fym-composer-shell--idle" : ""
            }`}
          >
          <textarea
            ref={notesAskTextareaRef as unknown as Ref<HTMLTextAreaElement>}
            className="max-h-24 min-h-[1.875rem] flex-1 resize-none border-0 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:text-muted"
            placeholder={
              draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : "输入问题…"
            }
            value={notesAskQuestion}
            onChange={(e) => setNotesAskQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (
                notesAskBusy ||
                draftSelectedNoteIds.length === 0 ||
                !notesAskQuestion.trim()
              ) {
                return;
              }
              void submitNotesAsk();
            }}
            disabled={notesAskBusy || draftSelectedNoteIds.length === 0}
            aria-label={
              draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : "向资料提问"
            }
            title={draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : undefined}
            rows={1}
          />
          <div className="mb-1 flex shrink-0 items-end">
            <NotesAskDialogueStylePicker
              value={notesAskDialogueStyle}
              onChange={setNotesAskDialogueStyle}
              hasNotebookStyle={Boolean(notebookStylePrompt.trim())}
              onRequestLearnStyle={
                !notebookStylePrompt.trim() &&
                draftSelectedNoteIds.length > 0 &&
                !sharedBrowse
                  ? scrollToNotebookStyleLearn
                  : undefined
              }
              disabled={
                notesAskBusy ||
                draftSelectedNoteIds.length === 0 ||
                (notesAskDialogueStyle === "notebook" && !notebookStylePrompt.trim())
              }
            />
          </div>
          {notesAskBusy ? (
            <button
              type="button"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-600/55 bg-amber-500/[0.18] text-amber-950 shadow-sm transition hover:bg-amber-500/[0.28] active:scale-[0.96] dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-50"
              title="停止生成"
              aria-label="停止生成"
              onClick={() => notesAskStreamAbortRef.current?.abort()}
            >
              <IconStopSquare width={16} height={16} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--dawn-brand)_35%,transparent)] transition-[opacity,transform] hover:opacity-95 active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
              disabled={draftSelectedNoteIds.length === 0 || !notesAskQuestion.trim()}
              title={
                draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : "提问"
              }
              aria-label="发送提问"
              onClick={() => void submitNotesAsk()}
            >
              <IconArrowRight width={18} height={18} aria-hidden />
            </button>
          )}
          </div>
          {NOTES_ASK_DEBUG_BODY_ENABLED ? (
            <div className="rounded-xl border border-amber-500/45 bg-amber-500/[0.08] px-3 py-2 text-xs leading-snug text-ink">
              <div className="mb-1.5 font-semibold text-amber-950 dark:text-amber-100">
                调试：问答 POST body（NEXT_PUBLIC_NOTES_ASK_DEBUG_BODY=1）
              </div>
              {!notesAskDebugClient ? (
                <p className="text-[11px] text-muted">正在解析请求 URL…</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-muted">
                    与当前表单一致：流式含 <code className="text-[10px]">question</code> 与{" "}
                    <code className="text-[10px]">note_ids</code>。浏览器已登录时会自动带 Cookie；curl 请把{" "}
                    <code className="text-[10px]">fym_session=PASTE</code> 换成真实值。
                  </p>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">POST /api/notes/ask/stream</span>
                      {notesAskDebugPack.streamReady ? (
                        <span className="text-[11px] text-success-ink">可发送</span>
                      ) : (
                        <span className="text-[11px] text-rose-600">未满足发送条件（笔记本 / 资料 / 问题）</span>
                      )}
                      <button
                        type="button"
                        className="rounded-md border border-line/80 bg-surface px-2 py-0.5 text-[11px] hover:bg-fill"
                        onClick={() => void copyNotesAskDebug(notesAskDebugPack.streamJsonPretty, "stream")}
                      >
                        {notesAskDebugCopied === "stream" ? "已复制 JSON" : "复制 JSON"}
                      </button>
                      <button
                        type="button"
                        disabled={!notesAskDebugCurls.streamCurl}
                        className="rounded-md border border-line/80 bg-surface px-2 py-0.5 text-[11px] hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void copyNotesAskDebug(notesAskDebugCurls.streamCurl, "curlStream")}
                      >
                        {notesAskDebugCopied === "curlStream" ? "已复制 curl" : "复制 curl"}
                      </button>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-fill/90 p-2 font-mono text-[11px] text-ink">
                      {notesAskDebugPack.streamJsonPretty}
                    </pre>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted">{notesAskDebugCurls.streamUrl}</p>
                    {notesAskDebugCurls.streamCurl ? (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-fill/50 p-2 font-mono text-[10px] text-muted">
                        {notesAskDebugCurls.streamCurl}
                      </pre>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
    </div>

  </div>
  <section className="w-full min-w-0 rounded-3xl border border-line/70 bg-fill/15 p-4 shadow-soft">
    <div
      className={`${WORKBENCH_PANEL_STICKY_HEAD} flex flex-wrap items-start justify-between gap-2 pb-3`}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">我的作品</h2>
        {notesWorkbenchCreationProgress ? (
          <div
            className={`mt-2 rounded-lg border px-2.5 py-1.5 text-xs ${
              notesWorkbenchCreationProgress.busy
                ? "border-brand/25 bg-fill/90 text-brand"
                : notesWorkbenchCreationProgress.doneTone
                  ? "border-success/35 bg-success-soft/80 text-success-ink"
                  : notesWorkbenchCreationProgress.warnTone
                    ? "border-warning/35 bg-warning-soft/70 text-warning-ink"
                    : "border-line/70 bg-fill/50 text-muted"
            }`}
            role="status"
            aria-live="polite"
          >
            <p className="line-clamp-3 leading-snug">{notesWorkbenchCreationProgress.text}</p>
            {notesWorkbenchCreationProgress.billingPodcast || notesWorkbenchCreationProgress.billingDraft ? (
              <BillingShortfallLinks className="mt-1.5 text-[11px] normal-case" />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-fill"
          onClick={() => setWorksPanelExpanded((v) => !v)}
        >
          {worksPanelExpanded ? "收起" : "展开"}
        </button>
        <a
          href={notesWorksViewAllHref}
          className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-brand hover:bg-fill"
        >
          查看全部
        </a>
      </div>
    </div>
    <div className="mt-4 w-full min-w-0 max-w-6xl">
      <div
        className={`overflow-y-auto overflow-x-hidden transition-[max-height] duration-200 ${
          worksPanelExpanded ? "max-h-[min(92vh,1040px)]" : "max-h-[min(46vh,520px)]"
        }`}
      >
        <NotesWorkbenchWorksPanel
          works={podcastWorks}
          loading={podcastWorksLoading}
          fetchError={podcastWorksError}
          onDismissError={() => setPodcastWorksError("")}
          onWorkDeleted={() => void fetchPodcastWorks()}
          pendingStudioWork={notesPendingStudioWork}
          pendingStudioSubtitle={notesPendingStudioSubtitle}
        />
      </div>
    </div>
  </section>
  </div>
</div>
  );
}
