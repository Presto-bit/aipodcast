"use client";

import Link from "next/link";
import { useCallback } from "react";
import { workCoverImageSrc } from "../../lib/workCoverImage";
import { useWorkAudioPlayer } from "../../lib/workAudioPlayer";
import { WorkHubManuscriptBar } from "./WorkHubManuscriptBar";

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

type Props = {
  jobId: string;
  displayTitleForDownload: string;
  episodeTitle: string;
  /** 预览区完整简介（可与发布表单 RSS 摘要长度策略不同） */
  previewIntro: string;
  coverUrl: string;
  /** 与「我的作品」卡片 meta 一致，用 | 分隔 */
  navMetaPipe: string;
  chapterOutline: { title: string; start_ms: number }[] | null;
  onSeekSeconds: (sec: number) => void;
  hasAudio: boolean;
  scriptDraft: boolean;
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
};

export function WorkHubOverviewPanel({
  jobId,
  displayTitleForDownload,
  episodeTitle,
  previewIntro,
  coverUrl,
  navMetaPipe,
  chapterOutline,
  onSeekSeconds,
  hasAudio,
  scriptDraft,
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
  audioRegenMessage
}: Props) {
  const workAudio = useWorkAudioPlayer();
  const activeThis = workAudio.activeJobId === jobId;
  const loadingThis = workAudio.loadingJobId === jobId;
  const playingThis = activeThis && workAudio.isPlaying;

  const onCoverPlayClick = useCallback(() => {
    if (!hasAudio || audioBlocked) return;
    void workAudio.togglePlay(jobId, { displayTitle: displayTitleForDownload.trim() || episodeTitle.trim() || jobId });
  }, [hasAudio, audioBlocked, workAudio, jobId, displayTitleForDownload, episodeTitle]);

  const coverSrc = workCoverImageSrc(coverUrl);
  const totalHint =
    durationSecHint != null && Number.isFinite(durationSecHint) && durationSecHint > 0
      ? formatClock(durationSecHint)
      : null;

  const scriptManuscriptPanel = scriptDraft && showManuscriptTools;
  const podcastChapterSection =
    !scriptDraft &&
    !audioBlocked &&
    (showManuscriptTools || (chapterOutline && chapterOutline.length > 0));
  const chapterSeekDisabled = !hasAudio || loadingThis;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-6">
        <div className="relative mx-auto aspect-square w-full max-w-[min(100%,20rem)] shrink-0 overflow-hidden rounded-2xl border border-line bg-fill/30 shadow-soft lg:mx-0 lg:aspect-auto lg:h-[280px] lg:w-[280px] lg:max-w-[280px]">
          {coverSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={coverSrc}
              alt=""
              className="aspect-square w-full object-cover"
              referrerPolicy="no-referrer"
              loading="eager"
            />
          ) : (
            <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-brand/[0.12] via-fill to-cta/[0.1] px-4 text-center lg:aspect-auto lg:h-[280px] lg:min-h-[280px]">
              <span className="text-3xl" aria-hidden>
                {scriptDraft ? "📝" : "🎙️"}
              </span>
              <span className="text-xs text-muted">{scriptDraft ? "文稿作品" : "暂无封面"}</span>
            </div>
          )}

          {!audioBlocked && hasAudio ? (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 sm:p-3">
              <button
                type="button"
                disabled={loadingThis}
                onClick={(e) => {
                  e.stopPropagation();
                  onCoverPlayClick();
                }}
                className="pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink/80 text-brand-foreground shadow-lg backdrop-blur-sm transition hover:bg-ink/90 disabled:opacity-50"
                aria-label={playingThis ? "暂停" : "播放"}
                title={playingThis ? "暂停" : totalHint ? `播放（约 ${totalHint}）` : "播放"}
              >
                {loadingThis ? (
                  <span className="h-5 w-5 animate-pulse rounded-full bg-brand-foreground/70" aria-hidden />
                ) : playingThis ? (
                  <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <svg className="ml-0.5 h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:h-[280px] lg:max-h-[280px] lg:overflow-hidden">
          <h2 className="shrink-0 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {episodeTitle.trim() || "未命名作品"}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain lg:min-h-0">
            {previewIntro.trim() ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted sm:text-[15px]">
                {previewIntro.trim()}
              </p>
            ) : (
              <p className="text-sm text-muted">暂无简介</p>
            )}
          </div>
          <p className="shrink-0 text-[11px] leading-relaxed text-muted break-words">{navMetaPipe.trim() || "—"}</p>
        </div>
      </div>

      {audioBlocked && !scriptDraft ? (
        <div className="rounded-2xl border border-warning/30 bg-warning-soft/80 px-4 py-4 text-sm text-warning-ink">
          <p>暂无可播放音频，请确认任务已成功完成。</p>
        </div>
      ) : null}

      {scriptManuscriptPanel ? (
        <p className="text-xs leading-relaxed text-muted">
          纯文稿作品无播客音频，无法试听或走 RSS 发布；可在下方阅读、编辑正文，或前往{" "}
          <Link href="/notes" className="font-medium text-brand underline">
            笔记工作台
          </Link>{" "}
          用相同素材再出稿。
        </p>
      ) : null}

      {scriptManuscriptPanel ? (
        <section className="rounded-2xl border border-line bg-fill/20 px-3 py-3 sm:px-4">
          {regenProgressEl}
          <h3 className="border-b border-line/60 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">文稿</h3>
          <div className="mt-3 min-w-0">
            <WorkHubManuscriptBar
              jobId={jobId}
              displayTitle={displayTitleForDownload}
              manuscriptBody={manuscriptBody}
              scriptResolvePending={scriptResolvePending}
              onManuscriptSaved={onManuscriptSaved}
              canEditScript={canEditScript}
              regenerateVoiceSupported={false}
              regenerateVoiceBusy={regenerateVoiceBusy}
              onRegenerateVoice={onRegenerateVoice}
            />
          </div>
        </section>
      ) : null}

      {podcastChapterSection ? (
        <section className="rounded-2xl border border-line bg-fill/20 px-3 py-3 sm:px-4">
          {regenProgressEl}
          <h3 className="border-b border-line/60 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">章节</h3>
          {showManuscriptTools ? (
            <div className="mt-3 min-w-0">
              <WorkHubManuscriptBar
                jobId={jobId}
                displayTitle={displayTitleForDownload}
                manuscriptBody={manuscriptBody}
                scriptResolvePending={scriptResolvePending}
                onManuscriptSaved={onManuscriptSaved}
                canEditScript={canEditScript}
                regenerateVoiceSupported={regenerateVoiceSupported}
                regenerateVoiceBusy={regenerateVoiceBusy}
                onRegenerateVoice={onRegenerateVoice}
              />
            </div>
          ) : null}
          {chapterOutline && chapterOutline.length > 0 ? (
            <ul className={`space-y-1.5 ${showManuscriptTools ? "mt-4" : "mt-2"}`}>
              {chapterOutline.map((c, i) => {
                const sec = Math.floor((c.start_ms || 0) / 1000);
                return (
                  <li key={`${c.title}-${i}`}>
                    <button
                      type="button"
                      disabled={chapterSeekDisabled}
                      onClick={() => onSeekSeconds(sec)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-surface disabled:opacity-40"
                    >
                      <span className="min-w-0 truncate">{c.title || `章节 ${i + 1}`}</span>
                      <span className="shrink-0 tabular-nums text-xs text-muted">{formatClock(sec)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={`text-[11px] text-muted ${showManuscriptTools ? "mt-4" : "mt-2"}`}>
              暂无章节时间轴（可在「发布」页编辑 Shownotes 插入章节）。
            </p>
          )}
        </section>
      ) : !scriptManuscriptPanel ? (
        regenProgressEl
      ) : null}
    </div>
  );
}
