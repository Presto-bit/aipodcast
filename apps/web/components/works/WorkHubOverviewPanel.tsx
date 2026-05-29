"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { workCoverImageSrc } from "../../lib/workCoverImage";
import { useWorkAudioPlayer } from "../../lib/workAudioPlayer";
import { WorkHubManuscriptBar } from "./WorkHubManuscriptBar";
import { WorkHubScriptActions } from "./WorkHubScriptActions";
import {
  buildSocialPublishManuscriptViewText,
  type SocialPublishWorkDetail
} from "../../lib/socialPublishWorkDetail";
import { IconPause, IconPlayFilled, WorkTypeIcon } from "../icons";

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export type WorkHubDetailTab = "edit" | "shownotes";

type Props = {
  jobId: string;
  displayTitleForDownload: string;
  episodeTitle: string;
  /** 发布表单中的简介（RSS 摘要），展示在标题下方 */
  episodeSummary: string;
  coverUrl: string;
  /** 与「我的作品」卡片 meta 一致，用 | 分隔 */
  navMetaPipe: string;
  /** 体裁展示名（如笔记文章 · 简报） */
  workProgramName?: string;
  hasAudio: boolean;
  scriptDraft: boolean;
  /** 自媒体发布稿：展示标题/配图等结构，正文区展示 body */
  socialPublishDraft?: boolean;
  socialPublishDetail?: SocialPublishWorkDetail | null;
  audioBlocked: boolean;
  durationSecHint: number | null;
  manuscriptBody: string;
  scriptResolvePending: boolean;
  onManuscriptSaved: (next: string) => void | Promise<void>;
  canEditScript: boolean;
  showManuscriptTools: boolean;
  regenerateVoiceSupported: boolean;
  regenerateVoiceBusy: boolean;
  onRegenerateVoice?: () => void;
  audioRegenActive: boolean;
  audioRegenProgress: number;
  audioRegenMessage: string;
  /** 编排任务仍在 queued/running：分区占位与进度条 */
  jobGenerating?: boolean;
  jobGenPlaceholder?: string;
  jobLiveLine?: string;
  jobLiveProgressPct?: number | null;
  jobFailedMessage?: string;
  readonlyEmptyHint?: string;
  /** 他人全站模板只读：禁用「编辑」分区切换 */
  hubViewerReadonly?: boolean;
  detailTab: WorkHubDetailTab;
  onDetailTabChange: (t: WorkHubDetailTab) => void;
  shownotesPanel: ReactNode;
  /** 播客成片：用户设置的开场白（优先展示合成润色后的 tts_intro_text） */
  podcastIntroDisplay?: string;
  /** 播客成片：用户设置的结束语 */
  podcastOutroDisplay?: string;
};

export function WorkHubOverviewPanel({
  jobId,
  displayTitleForDownload,
  episodeTitle,
  episodeSummary,
  coverUrl,
  navMetaPipe,
  workProgramName = "",
  hasAudio,
  scriptDraft,
  socialPublishDraft = false,
  socialPublishDetail = null,
  audioBlocked,
  durationSecHint,
  manuscriptBody,
  scriptResolvePending,
  onManuscriptSaved,
  canEditScript,
  showManuscriptTools,
  regenerateVoiceSupported,
  regenerateVoiceBusy,
  onRegenerateVoice,
  audioRegenActive,
  audioRegenProgress,
  audioRegenMessage,
  jobGenerating = false,
  jobGenPlaceholder = "生成中,请稍等...",
  jobLiveLine,
  jobLiveProgressPct,
  jobFailedMessage,
  readonlyEmptyHint,
  hubViewerReadonly = false,
  detailTab,
  onDetailTabChange,
  shownotesPanel,
  podcastIntroDisplay = "",
  podcastOutroDisplay = ""
}: Props) {
  const workAudio = useWorkAudioPlayer();
  const activeThis = workAudio.activeJobId === jobId;
  const loadingThis = workAudio.loadingJobId === jobId;
  const playingThis = activeThis && workAudio.isPlaying;
  const [scriptDeleteBump, setScriptDeleteBump] = useState(0);
  const [scriptChapterEditing, setScriptChapterEditing] = useState(false);

  useEffect(() => {
    setScriptChapterEditing(false);
    setScriptDeleteBump(0);
  }, [jobId]);

  const textOnlyManuscript = scriptDraft || socialPublishDraft;
  const scriptManuscriptPanel = textOnlyManuscript && showManuscriptTools;
  const podcastChapterSection = !scriptDraft && !audioBlocked && showManuscriptTools;

  const manuscriptPreviewBody = useMemo(() => {
    if (socialPublishDraft && socialPublishDetail) {
      return buildSocialPublishManuscriptViewText(manuscriptBody, socialPublishDetail);
    }
    return manuscriptBody;
  }, [socialPublishDraft, socialPublishDetail, manuscriptBody]);

  const onCoverPlayClick = useCallback(() => {
    if (!hasAudio || audioBlocked) return;
    void workAudio.togglePlay(jobId, { displayTitle: displayTitleForDownload.trim() || episodeTitle.trim() || jobId });
  }, [hasAudio, audioBlocked, workAudio, jobId, displayTitleForDownload, episodeTitle]);

  const coverSrc = workCoverImageSrc(coverUrl);
  const totalHint =
    durationSecHint != null && Number.isFinite(durationSecHint) && durationSecHint > 0
      ? formatClock(durationSecHint)
      : null;

  const introBlock =
    podcastIntroDisplay.trim().length > 0 ? (
      <div className="mb-3 rounded-xl border border-line/80 bg-fill/35 px-3 py-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">开场白</h4>
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap [font-family:var(--dawn-font-sans)] text-[12px] leading-relaxed text-ink sm:text-[13px]">
          {podcastIntroDisplay.trim()}
        </pre>
        <p className="mt-1 text-[10px] leading-snug text-muted">此段与口播正文分开合成，不在下方对话稿内。</p>
      </div>
    ) : null;

  const outroBlock =
    podcastOutroDisplay.trim().length > 0 ? (
      <div className="mb-3 rounded-xl border border-line/80 bg-fill/35 px-3 py-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">结束语</h4>
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap [font-family:var(--dawn-font-sans)] text-[12px] leading-relaxed text-ink sm:text-[13px]">
          {podcastOutroDisplay.trim()}
        </pre>
        <p className="mt-1 text-[10px] leading-snug text-muted">此段与口播正文分开合成，不在下方对话稿内。</p>
      </div>
    ) : null;

  const regenProgressEl =
    audioRegenActive ? (
      <div className="mb-3 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, audioRegenProgress))}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted" role="status">
          {audioRegenMessage}
        </p>
      </div>
    ) : null;

  const jobLivePct =
    typeof jobLiveProgressPct === "number" && Number.isFinite(jobLiveProgressPct)
      ? Math.min(100, Math.max(0, jobLiveProgressPct))
      : null;
  const jobGenProgressEl =
    jobGenerating && !audioRegenActive ? (
      <div className="mb-3 rounded-xl border border-brand/25 bg-brand/10 px-3 py-2">
        {jobLivePct != null ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
              style={{ width: `${jobLivePct}%` }}
            />
          </div>
        ) : null}
        <p className={`text-[11px] text-muted ${jobLivePct != null ? "mt-1.5" : ""}`} role="status">
          {jobLiveLine?.trim() || jobGenPlaceholder}
        </p>
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      {jobFailedMessage?.trim() ? (
        <div className="rounded-xl border border-danger/35 bg-danger-soft/80 px-3 py-2 text-sm text-danger-ink" role="alert">
          {jobFailedMessage.trim()}
        </div>
      ) : null}
      {jobGenProgressEl}
      <div
        className={
          textOnlyManuscript
            ? "flex flex-col gap-3 rounded-xl border border-line/80 bg-fill/20 p-3 sm:p-4"
            : "flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-5"
        }
      >
        {!textOnlyManuscript ? (
          <>
            <div className="relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-xl border border-line bg-fill/30 shadow-soft sm:h-[4.75rem] sm:w-[4.75rem]">
              {coverSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={coverSrc}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="eager"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-gradient-to-br from-brand/[0.12] via-fill to-cta/[0.1] px-1 text-center">
                  <WorkTypeIcon scriptDraft={false} size={22} className="text-brand/80" aria-hidden />
                  <span className="scale-90 text-[9px] leading-tight text-muted">无封面</span>
                </div>
              )}

              {!audioBlocked && hasAudio ? (
                <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-1">
                  <button
                    type="button"
                    disabled={loadingThis}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCoverPlayClick();
                    }}
                    className="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/80 text-brand-foreground shadow-md backdrop-blur-sm transition hover:bg-ink/90 disabled:opacity-50"
                    aria-label={playingThis ? "暂停" : "播放"}
                    title={playingThis ? "暂停" : totalHint ? `播放（约 ${totalHint}）` : "播放"}
                  >
                    {loadingThis ? (
                      <span className="h-3 w-3 animate-pulse rounded-full bg-brand-foreground/70" aria-hidden />
                    ) : playingThis ? (
                      <IconPause className="h-3 w-3 text-white" aria-hidden />
                    ) : (
                      <IconPlayFilled className="ml-px h-3.5 w-3.5 text-white" aria-hidden />
                    )}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-center sm:text-left">
              <h2 className="text-balance text-base font-semibold tracking-tight text-ink sm:text-lg">
                {episodeTitle.trim() || "未命名作品"}
              </h2>
              {jobGenerating ? null : episodeSummary.trim() ? (
                <p className="text-[13px] leading-relaxed text-muted sm:text-sm">{episodeSummary.trim()}</p>
              ) : (
                <p className="text-[13px] text-muted sm:text-sm">暂无简介</p>
              )}
              <p className="text-[11px] leading-relaxed text-muted break-words sm:text-xs">{navMetaPipe.trim() || "—"}</p>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <h2 className="text-balance text-base font-semibold tracking-tight text-ink sm:text-lg">
              {episodeTitle.trim() || "未命名作品"}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted break-words sm:text-xs">
              {navMetaPipe.trim() || "—"}
            </p>
          </div>
        )}
      </div>

      {!textOnlyManuscript ? (
        <div className="flex gap-1 rounded-xl border border-line bg-fill/35 p-1">
          <button
            type="button"
            disabled={hubViewerReadonly}
            onClick={() => onDetailTabChange("edit")}
            title={hubViewerReadonly ? "模板作品仅创建者可编辑章节与口播稿" : undefined}
            className={`min-h-[2.5rem] flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
              detailTab === "edit"
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:bg-fill/60 hover:text-ink"
            }`}
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() => onDetailTabChange("shownotes")}
            className={`min-h-[2.5rem] flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
              detailTab === "shownotes"
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:bg-fill/60 hover:text-ink"
            }`}
          >
            Shownotes
          </button>
        </div>
      ) : null}

      {audioBlocked && !textOnlyManuscript ? (
        jobGenerating ? (
          <div className="rounded-2xl border border-brand/25 bg-brand/10 px-4 py-4 text-sm text-brand">
            <p>{jobLiveLine?.trim() || jobGenPlaceholder}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-warning/30 bg-warning-soft/80 px-4 py-4 text-sm text-warning-ink">
            <p>暂无可播放音频，请确认任务已成功完成。</p>
          </div>
        )
      ) : null}

      {textOnlyManuscript || detailTab === "edit" ? (
        <>
          {scriptManuscriptPanel ? (
            <section id="work-hub-manuscript" className="rounded-2xl border border-line bg-fill/20 px-3 py-3 sm:px-4 scroll-mt-24">
              {regenProgressEl}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">正文</h3>
                {showManuscriptTools ? (
                  <WorkHubScriptActions
                    manuscriptBody={manuscriptBody}
                    scriptResolvePending={scriptResolvePending}
                    canEditScript={canEditScript}
                    showScriptEditToggle={false}
                    regenerateVoiceSupported={false}
                    regenerateVoiceBusy={false}
                    onDeleteClick={() => setScriptDeleteBump((n) => n + 1)}
                  />
                ) : null}
              </div>
              <div
                className={
                  socialPublishDraft
                    ? "mt-3 min-w-0 max-h-[min(80vh,36rem)] overflow-y-auto"
                    : "mt-3 min-w-0"
                }
              >
                {socialPublishDraft && socialPublishDetail && socialPublishDetail.titles.some((t) => t.trim()) ? (
                  <div className="mb-4">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">备选标题</h4>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-ink">
                      {socialPublishDetail.titles.map((t, i) =>
                        t.trim() ? (
                          <li
                            key={`title-${i}`}
                            className={i === socialPublishDetail.selectedTitleIndex ? "font-medium text-brand" : undefined}
                          >
                            {t.trim()}
                          </li>
                        ) : null
                      )}
                    </ol>
                  </div>
                ) : null}
                {socialPublishDraft && socialPublishDetail?.theme ? (
                  <div className="mb-4">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">主题</h4>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink">{socialPublishDetail.theme}</p>
                  </div>
                ) : null}
                {socialPublishDraft && socialPublishDetail && socialPublishDetail.imageSuggestions.length > 0 ? (
                  <div className="mb-4">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">配图建议</h4>
                    <ul className="mt-2 list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-ink">
                      {socialPublishDetail.imageSuggestions.map((s, i) => (
                        <li key={`img-${i}`}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <WorkHubManuscriptBar
                  jobId={jobId}
                  manuscriptBody={manuscriptBody}
                  previewBody={manuscriptPreviewBody}
                  scriptResolvePending={scriptResolvePending}
                  onManuscriptSaved={onManuscriptSaved}
                  canEditScript={canEditScript}
                  regenerateVoiceSupported={false}
                  regenerateVoiceBusy={regenerateVoiceBusy}
                  onRegenerateVoice={onRegenerateVoice}
                  pureManuscriptOnly
                  hideToolbar
                  innerScroll={!socialPublishDraft}
                  requestDelete={scriptDeleteBump}
                  readonlyEmptyHint={readonlyEmptyHint}
                />
              </div>
            </section>
          ) : null}

          {podcastChapterSection ? (
            <section className="flex min-h-[min(72vh,40rem)] flex-col rounded-2xl border border-line bg-fill/20 px-3 py-3 sm:px-4">
              {regenProgressEl}
              {introBlock}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">章节</h3>
                {showManuscriptTools ? (
                  <WorkHubScriptActions
                    manuscriptBody={manuscriptBody}
                    scriptResolvePending={scriptResolvePending}
                    canEditScript={canEditScript}
                    showScriptEditToggle={canEditScript}
                    scriptEditing={scriptChapterEditing}
                    onToggleScriptEditing={() => setScriptChapterEditing((v) => !v)}
                    regenerateVoiceSupported={regenerateVoiceSupported}
                    regenerateVoiceBusy={regenerateVoiceBusy}
                    onRegenerateVoice={onRegenerateVoice}
                    onDeleteClick={() => setScriptDeleteBump((n) => n + 1)}
                  />
                ) : null}
              </div>
              {showManuscriptTools ? (
                <div className="mt-3 min-w-0 flex-1">
                  <WorkHubManuscriptBar
                    jobId={jobId}
                    manuscriptBody={manuscriptBody}
                    scriptResolvePending={scriptResolvePending}
                    onManuscriptSaved={onManuscriptSaved}
                    canEditScript={canEditScript}
                    regenerateVoiceSupported={regenerateVoiceSupported}
                    regenerateVoiceBusy={regenerateVoiceBusy}
                    onRegenerateVoice={onRegenerateVoice}
                    hideToolbar
                    scriptAutosave
                    requestDelete={scriptDeleteBump}
                    chapterEditorOpen={scriptChapterEditing}
                    readonlyEmptyHint={readonlyEmptyHint}
                    tallScriptArea
                  />
                </div>
              ) : null}
              {outroBlock}
            </section>
          ) : !scriptManuscriptPanel ? (
            <>
              {introBlock}
              {outroBlock}
              {regenProgressEl}
            </>
          ) : null}
        </>
      ) : (
        shownotesPanel
      )}
    </div>
  );
}
