"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { NotesGuidanceKind } from "../../lib/notesNextStepsGuidance";
import { guidanceTipForKind } from "../../lib/notesNextStepsGuidance";

type NotesNextStepsGuidanceProps = {
  kind: NotesGuidanceKind;
  noteRefCap: number;
  /** 本次引导锁定的资料 id（用于副文案） */
  lockedSampleTitles: string[];
  guidanceMoreOpen: boolean;
  onGuidanceMoreOpenChange: (open: boolean) => void;
  onSnooze: () => void;
  onDefaultOutline: () => void;
  onAskDigest: () => void;
  onAskStructure: () => void;
  onOpenMorePodcastGenres: () => void;
  onOpenArticle: () => void;
  onAskReadingPodcast: () => void;
  onAskInterviewPlan: () => void;
  onAskDebateSketch: () => void;
};

export function NotesNextStepsGuidanceBurst(props: NotesNextStepsGuidanceProps) {
  const {
    kind,
    noteRefCap,
    lockedSampleTitles,
    guidanceMoreOpen,
    onGuidanceMoreOpenChange,
    onSnooze,
    onDefaultOutline,
    onAskDigest,
    onAskStructure,
    onOpenMorePodcastGenres,
    onOpenArticle,
    onAskReadingPodcast,
    onAskInterviewPlan,
    onAskDebateSketch
  } = props;

  const tip = useMemo(() => guidanceTipForKind(kind), [kind]);
  const sample = lockedSampleTitles.filter(Boolean).slice(0, 2).join("、");

  return (
    <section
      className="mb-3 rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/[0.07] via-surface to-surface p-3.5 shadow-soft sm:p-4"
      aria-labelledby="notes-next-steps-title"
    >
      <h2 id="notes-next-steps-title" className="text-sm font-semibold text-ink">
        新资料已加入
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{tip}</p>
      {sample ? (
        <p className="mt-1 text-[11px] text-muted/90" title={lockedSampleTitles.join("、")}>
          本次可先围绕：{sample}
          {lockedSampleTitles.length > 2 ? "…" : ""}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] text-muted">勾选资料上限与套餐一致（当前最多 {noteRefCap} 条）。</p>

      <div className="mt-3">
        <button
          type="button"
          className="w-full rounded-xl bg-brand px-3 py-2.5 text-left text-sm font-semibold text-brand-foreground shadow-soft transition-opacity hover:opacity-95 active:scale-[0.99]"
          onClick={onDefaultOutline}
        >
          不知道做什么？先点这里：生成「可录播」口播大纲（已选好体裁）
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="rounded-xl border border-line/90 bg-fill/80 px-3 py-2 text-left text-xs font-medium text-ink transition-colors hover:border-brand/35 hover:bg-surface"
          onClick={onAskDigest}
        >
          约 1 分钟：问资料「讲了什么」
          <span className="mt-0.5 block text-[10px] font-normal text-muted">自动填好问题，你点发送即可</span>
        </button>
        <button
          type="button"
          className="rounded-xl border border-line/90 bg-fill/80 px-3 py-2 text-left text-xs font-medium text-ink transition-colors hover:border-brand/35 hover:bg-surface"
          onClick={onAskStructure}
        >
          约 1 分钟：生成口播结构（标题级）
          <span className="mt-0.5 block text-[10px] font-normal text-muted">开场 / 三板块 / 结尾 CTA</span>
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-line/60 bg-surface/80 px-2.5 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">类似资料 · 常做</p>
        <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className="rounded-lg border border-line/70 bg-fill/50 px-2 py-1.5 text-left text-[11px] text-ink hover:border-brand/30 sm:min-w-0 sm:flex-1"
            onClick={onAskReadingPodcast}
          >
            讲书式口播结构
          </button>
          <button
            type="button"
            className="rounded-lg border border-line/70 bg-fill/50 px-2 py-1.5 text-left text-[11px] text-ink hover:border-brand/30 sm:min-w-0 sm:flex-1"
            onClick={onAskInterviewPlan}
          >
            访谈问题清单
          </button>
          <button
            type="button"
            className="rounded-lg border border-line/70 bg-fill/50 px-2 py-1.5 text-left text-[11px] text-ink hover:border-brand/30 sm:min-w-0 sm:flex-1"
            onClick={onAskDebateSketch}
          >
            争议点正反梳理
          </button>
        </div>
      </div>

      <div className="mt-2">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-medium text-brand hover:bg-brand/5"
          aria-expanded={guidanceMoreOpen}
          onClick={() => onGuidanceMoreOpenChange(!guidanceMoreOpen)}
        >
          <span>更多选项</span>
          <span className="text-muted" aria-hidden>
            {guidanceMoreOpen ? "▾" : "▸"}
          </span>
        </button>
        {guidanceMoreOpen ? (
          <div className="mt-2 space-y-2 rounded-xl border border-line/70 bg-surface/90 p-2.5">
            <button
              type="button"
              className="w-full rounded-lg border border-line/80 bg-fill/60 px-2.5 py-2 text-left text-xs text-ink hover:border-brand/30"
              onClick={onOpenMorePodcastGenres}
            >
              生成播客（先选体裁）
              <span className="mt-0.5 block text-[10px] text-muted">深夜聊天 / 深度讨论 / 多视角等</span>
            </button>
            <button
              type="button"
              className="w-full rounded-lg border border-line/80 bg-fill/60 px-2.5 py-2 text-left text-xs text-ink hover:border-brand/30"
              onClick={onOpenArticle}
            >
              生成长文 / 底稿
            </button>
            <p className="text-[10px] leading-snug text-muted">
              若已有干声需要转写与剪辑，可前往{" "}
              <Link href="/clip" className="font-medium text-brand underline-offset-2 hover:underline">
                文稿剪辑
              </Link>
              。
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line/50 pt-2.5">
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={onSnooze}>
          暂不（收起到左侧「还能做什么」）
        </button>
      </div>
    </section>
  );
}

type ReturnBarProps = {
  onTry: () => void;
  onDismiss: () => void;
};

export function NotesNextStepsReturnBar({ onTry, onDismiss }: ReturnBarProps) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/25 bg-brand/[0.06] px-3 py-2 text-xs text-ink"
      role="status"
    >
      <p className="min-w-0 flex-1 leading-snug">你最近加了资料，可以试试一键生成口播大纲。</p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-medium text-brand-foreground shadow-soft hover:opacity-95"
          onClick={onTry}
        >
          试一下
        </button>
        <button type="button" className="rounded-lg border border-line/80 px-2.5 py-1.5 text-xs text-muted hover:text-ink" onClick={onDismiss}>
          知道了
        </button>
      </div>
    </div>
  );
}

type SidebarPeekProps = {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  onDefaultOutline: () => void;
  onAskDigest: () => void;
  onAskStructure: () => void;
  onOpenMorePodcastGenres: () => void;
  onOpenArticle: () => void;
  onAskReadingPodcast: () => void;
  onAskInterviewPlan: () => void;
  onAskDebateSketch: () => void;
};

export function NotesNextStepsSidebarPeek({
  expanded,
  onExpandedChange,
  onDefaultOutline,
  onAskDigest,
  onAskStructure,
  onOpenMorePodcastGenres,
  onOpenArticle,
  onAskReadingPodcast,
  onAskInterviewPlan,
  onAskDebateSketch
}: SidebarPeekProps) {
  const [exampleOpen, setExampleOpen] = useState(false);

  return (
    <div className="mt-2 rounded-xl border border-dashed border-line/80 bg-fill/40 p-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-brand"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span>还能做什么</span>
        <span className="text-muted" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 space-y-1.5">
          <button
            type="button"
            className="w-full rounded-lg bg-brand/90 px-2 py-1.5 text-left text-[11px] font-semibold text-brand-foreground"
            onClick={onDefaultOutline}
          >
            一键：口播大纲
          </button>
          <button type="button" className="w-full rounded-lg bg-fill px-2 py-1.5 text-left text-[11px] text-ink" onClick={onAskDigest}>
            问资料：讲了什么
          </button>
          <button type="button" className="w-full rounded-lg bg-fill px-2 py-1.5 text-left text-[11px] text-ink" onClick={onAskStructure}>
            问资料：口播结构
          </button>
          <button
            type="button"
            className="w-full rounded-lg bg-fill px-2 py-1.5 text-left text-[11px] text-ink"
            onClick={onOpenMorePodcastGenres}
          >
            播客 · 更多体裁
          </button>
          <button type="button" className="w-full rounded-lg bg-fill px-2 py-1.5 text-left text-[11px] text-ink" onClick={onOpenArticle}>
            长文 / 底稿
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left text-[11px] text-muted"
            aria-expanded={exampleOpen}
            onClick={() => setExampleOpen(!exampleOpen)}
          >
            <span>类似资料 · 示例一键问</span>
            <span aria-hidden>{exampleOpen ? "▾" : "▸"}</span>
          </button>
          {exampleOpen ? (
            <div className="space-y-1 border-t border-line/60 pt-1.5">
              <button
                type="button"
                className="w-full rounded-lg border border-line/70 px-2 py-1.5 text-left text-[10px] leading-snug text-ink hover:bg-surface"
                onClick={() => {
                  onExpandedChange(false);
                  onAskReadingPodcast();
                }}
              >
                讲书式：3 分钟口播结构
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-line/70 px-2 py-1.5 text-left text-[10px] leading-snug text-ink hover:bg-surface"
                onClick={() => {
                  onExpandedChange(false);
                  onAskInterviewPlan();
                }}
              >
                访谈式：问题清单
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-line/70 px-2 py-1.5 text-left text-[10px] leading-snug text-ink hover:bg-surface"
                onClick={() => {
                  onExpandedChange(false);
                  onAskDebateSketch();
                }}
              >
                讨论向：正反论据 + 小结
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
