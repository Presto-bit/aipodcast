"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconMic, IconTts } from "../../components/NavIcons";
import type { PodcastStudioActivity } from "../../components/studio/PodcastStudio";
import type { TtsStudioActivity } from "../../components/studio/TtsStudio";

const PodcastStudio = dynamic(() => import("../../components/studio/PodcastStudio"));
const TtsStudio = dynamic(() => import("../../components/studio/TtsStudio"));
const PodcastWorksGallery = dynamic(() => import("../../components/podcast/PodcastWorksGallery"), {
  loading: () => (
    <div
      className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
      aria-busy
      aria-label="加载作品列表"
    />
  )
});
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import { mergeUserFacingWorksByRecency, type WorkItem } from "../../lib/worksTypes";
import { NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { BillingShortfallLinks } from "../../components/subscription/BillingShortfallLinks";

type HotTopicAssistantItem = { label: string; text: string };

type CreateWorksTab = "recent" | "templates";

type CreateMode = "podcast" | "tts";

const HOME_WORKS_LIMIT = 80;

const DRAFT_PLACEHOLDER = "输入主题或正文";

export default function CreatePage() {
  const { t } = useI18n();
  const { getAuthHeaders } = useAuth();

  const [draftText, setDraftText] = useState("");
  const [libraryPreview, setLibraryPreview] = useState("");
  const [mode, setMode] = useState<CreateMode | null>("podcast");

  const [podcastAct, setPodcastAct] = useState<PodcastStudioActivity>({ busy: false, phase: "", progressPct: 0 });
  const [ttsAct, setTtsAct] = useState<TtsStudioActivity>({ busy: false, phase: "", progressPct: 0 });

  const [homeWorks, setHomeWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(true);
  const [worksErr, setWorksErr] = useState("");
  const [hotTopicSeed, setHotTopicSeed] = useState(() => Math.floor(Date.now() % 2147483646) + 1);
  const [hotTopics, setHotTopics] = useState<HotTopicAssistantItem[]>([]);
  const [hotTopicsLoading, setHotTopicsLoading] = useState(false);
  const [hotTopicsErr, setHotTopicsErr] = useState("");
  const [hotTopicAssistantOpen, setHotTopicAssistantOpen] = useState(false);
  /** 区分「本次已处于展开」与「刚从折叠变为展开」，避免展开态下随 state 重渲染重复请求 */
  const hotTopicPanelWasOpenRef = useRef(false);
  /** 用户手动切换「我的 / 模板」；`homeWorks.length` 变化时清空，回到系统默认策略 */
  const [createWorksTabOverride, setCreateWorksTabOverride] = useState<CreateWorksTab | null>(null);
  const [serverPodcastTemplates, setServerPodcastTemplates] = useState<WorkItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesErr, setTemplatesErr] = useState("");

  const fetchHotTopics = useCallback(async (seed: number, opts?: { preserveOnError?: boolean }) => {
    setHotTopicsLoading(true);
    setHotTopicsErr("");
    try {
      const res = await fetch(`/api/create/hot-topics?seed=${encodeURIComponent(String(seed))}`, {
        cache: "default",
        credentials: "same-origin"
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        topics?: HotTopicAssistantItem[];
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `热点加载失败 ${res.status}`);
      }
      const list = Array.isArray(data.topics) ? data.topics : [];
      setHotTopics(list);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (opts?.preserveOnError) {
        setHotTopicsErr(msg);
        return;
      }
      setHotTopics([]);
      setHotTopicsErr(msg);
    } finally {
      setHotTopicsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hotTopicAssistantOpen) {
      hotTopicPanelWasOpenRef.current = false;
      return;
    }
    const wasAlreadyOpen = hotTopicPanelWasOpenRef.current;
    hotTopicPanelWasOpenRef.current = true;
    if (wasAlreadyOpen) return;
    if (hotTopics.length > 0) return;
    void fetchHotTopics(hotTopicSeed);
  }, [hotTopicAssistantOpen, hotTopics.length, hotTopicSeed, fetchHotTopics]);

  const refreshHotTopics = useCallback(() => {
    const next = (hotTopicSeed + 7919) % 2147483646;
    setHotTopicSeed(next);
    void fetchHotTopics(next, { preserveOnError: true });
  }, [fetchHotTopics, hotTopicSeed]);

  const refreshWorks = useCallback(async () => {
    setWorksErr("");
    try {
      const res = await fetch(`/api/works?limit=${HOME_WORKS_LIMIT}&offset=0`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        ai?: WorkItem[];
        tts?: WorkItem[];
        notes?: WorkItem[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || data.success === false) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
      const merged = mergeUserFacingWorksByRecency(
        Array.isArray(data.ai) ? data.ai : [],
        Array.isArray(data.tts) ? data.tts : [],
        Array.isArray(data.notes) ? data.notes : []
      );
      // 创作页「最近成品」仅展示主站创作入口产出，不含笔记本工作室（同一项目名下）的成片
      setHomeWorks(
        merged.filter((w) => String(w.projectName || "").trim() !== NOTES_PODCAST_PROJECT_NAME)
      );
    } catch (e) {
      setWorksErr(String(e instanceof Error ? e.message : e));
    } finally {
      setWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void refreshWorks();
  }, [refreshWorks]);

  const refreshPodcastTemplates = useCallback(async () => {
    setTemplatesErr("");
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/works/podcast-templates?limit=40&offset=0", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        templates?: WorkItem[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.detail || `模板加载失败 ${res.status}`);
      }
      setServerPodcastTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (e) {
      setTemplatesErr(String(e instanceof Error ? e.message : e));
      setServerPodcastTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void refreshPodcastTemplates();
  }, [refreshPodcastTemplates]);

  useEffect(() => {
    setCreateWorksTabOverride(null);
  }, [homeWorks.length]);

  useEffect(() => {
    if (mode !== "podcast") setLibraryPreview("");
  }, [mode]);

  const act = mode === "podcast" ? podcastAct : mode === "tts" ? ttsAct : null;
  /** 与 TtsStudio 内嵌一致：仅有 phase、无 progress 数字时也要展示（如校验提示、润色/接口错误文案） */
  const showProgress = Boolean(
    act && (act.busy || (act.phase ?? "").trim().length > 0 || act.progressPct > 0)
  );

  const createPageEyebrow = t("create.pageEyebrow").trim();
  const createPageSubtitle = t("create.pageSubtitle").trim();

  const createWorksGalleryTab: CreateWorksTab =
    createWorksTabOverride ?? (worksLoading ? "recent" : homeWorks.length > 0 ? "recent" : "templates");

  const templateGalleryWorks = useMemo(() => [...serverPodcastTemplates], [serverPodcastTemplates]);

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-12 pt-3 sm:px-4 sm:pt-6">
      <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6 border-l-2 border-brand/35 pl-4 sm:mb-10 sm:pl-5">
        {createPageEyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{createPageEyebrow}</p>
        ) : null}
        <h1
          className={
            createPageEyebrow
              ? "mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
              : "text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          }
        >
          {t("create.pageTitle")}
        </h1>
        {createPageSubtitle ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{createPageSubtitle}</p>
        ) : null}
      </header>

      <section className="fym-surface-card fym-tech-cap overflow-visible">
        <div className="p-4 sm:p-5">
          <label className="sr-only" htmlFor="create-draft">
            输入主题或正文
          </label>
          {/* 角标摘要仅叠在正文框内，模式条独立在下方，避免遮挡「创作播客 / 文字转语音」 */}
          <div className="overflow-hidden rounded-xl border border-line bg-fill ring-brand/20 focus-within:ring-2">
            <div className="relative">
              <textarea
                id="create-draft"
                className={[
                  "min-h-[min(22vh,140px)] w-full resize-y border-0 bg-transparent p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none focus:ring-0 md:min-h-[160px]",
                  libraryPreview.trim() ? "pb-14 sm:pb-16" : "pb-4"
                ].join(" ")}
                placeholder={DRAFT_PLACEHOLDER}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
              />
              {libraryPreview.trim() ? (
                <div
                  className="absolute bottom-2 left-2 right-2 z-[1] max-h-14 min-h-0 overflow-y-auto rounded-md border border-line/60 bg-surface/95 px-2 py-1.5 text-[10px] leading-snug text-muted shadow-sm backdrop-blur-sm sm:max-h-[4.5rem]"
                  title={`已选资料 · ${libraryPreview}`}
                >
                  <span className="text-muted">已选资料 · </span>
                  <span className="break-words text-ink/85">{libraryPreview}</span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface/95 px-3 py-2.5 backdrop-blur-sm">
              {(
                [
                  { id: "podcast" as const, title: t("create.card.podcast.title"), Icon: IconMic },
                  { id: "tts" as const, title: t("create.card.tts.title"), Icon: IconTts }
                ] as const
              ).map((row) => {
                const on = mode === row.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setMode((m) => (m === row.id ? null : row.id))}
                    className={[
                      "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition sm:text-sm",
                      on ? "border-brand/50 bg-brand/10 text-brand" : "border-line bg-surface text-ink hover:border-brand/30 hover:bg-fill"
                    ].join(" ")}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-fill text-muted">
                      <row.Icon width={16} height={16} />
                    </span>
                    {row.title}
                  </button>
                );
              })}
            </div>
          </div>

          {!mode ? null : (
            <div className="mt-4">
              {mode === "podcast" ? (
                <PodcastStudio
                  embedded
                  blendOuterCard
                  contentText={draftText}
                  onContentTextChange={setDraftText}
                  hideGenerateButton={false}
                  showGallery={false}
                  onActivityChange={setPodcastAct}
                  onExternalListRefresh={() => void refreshWorks()}
                  onLibrarySelectionPreviewChange={setLibraryPreview}
                />
              ) : (
                <TtsStudio
                  embedded
                  blendOuterCard
                  contentText={draftText}
                  onContentTextChange={setDraftText}
                  hideGenerateButton={false}
                  showGallery={false}
                  onActivityChange={setTtsAct}
                  onExternalListRefresh={() => void refreshWorks()}
                />
              )}
            </div>
          )}
        </div>

        {mode && showProgress && act ? (
          <div className="border-t border-line bg-fill/60 px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-muted">状态</p>
            <p className="mt-1 text-sm text-ink">{act.phase || (act.busy ? "处理中…" : "—")}</p>
            {messageSuggestsBillingTopUpOrSubscription(act.phase || "") ? (
              <BillingShortfallLinks className="mt-2" />
            ) : null}
            {act.busy || act.progressPct > 0 ? (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: `${Math.min(100, Math.max(2, act.progressPct))}%` }}
                />
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <Link href="/jobs" className="font-medium text-brand hover:underline">
                任务详情
              </Link>
              <Link href="/works" className="font-medium text-brand hover:underline">
                我的作品
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-line bg-fill/25">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-fill/50 sm:px-4"
          aria-expanded={hotTopicAssistantOpen}
          aria-controls="create-hot-topic-panel"
          onClick={() => setHotTopicAssistantOpen((o) => !o)}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">选题助手</span>
          {hotTopicsErr && !hotTopicAssistantOpen ? (
            <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
              加载失败
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            {hotTopicsLoading && !hotTopicAssistantOpen ? (
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted border-t-brand"
                aria-hidden
              />
            ) : null}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className={`shrink-0 text-muted transition-transform duration-200 ${hotTopicAssistantOpen ? "rotate-180" : ""}`}
              aria-hidden
            >
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        <div
          id="create-hot-topic-panel"
          hidden={!hotTopicAssistantOpen}
          className="border-t border-line px-3 pb-3 pt-2 sm:px-4"
        >
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              disabled={hotTopicsLoading}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-fill/50 text-muted transition hover:border-brand/40 hover:bg-brand/10 hover:text-brand disabled:pointer-events-none disabled:opacity-40"
              title="换一批"
              aria-label="换一批"
              onClick={() => refreshHotTopics()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
                className={hotTopicsLoading ? "animate-spin" : ""}
              >
                <path
                  d="M4 9a8 8 0 0113.657-5.657M20 15a8 8 0 01-13.657 5.657M20 15v-4M4 9v4"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          {hotTopicsErr ? (
            <p className="mb-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
              {hotTopicsErr}
            </p>
          ) : null}
          <div
            className={`grid grid-cols-3 grid-rows-2 gap-2 sm:gap-3 ${hotTopicsLoading ? "opacity-70" : ""}`}
          >
            {hotTopics.length === 0 && hotTopicsLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={`sk-${i}`}
                    className="min-h-[4.25rem] animate-pulse rounded-lg border border-line bg-fill/80"
                    aria-hidden
                  />
                ))
              : hotTopics.map((topic, idx) => (
                  <button
                    key={`${hotTopicSeed}-${idx}-${topic.label}`}
                    type="button"
                    className="flex min-h-[4.25rem] items-start rounded-lg border border-line bg-fill/40 px-2.5 py-2 text-left text-xs leading-snug text-ink transition hover:border-brand/40 hover:bg-brand/5 sm:px-3 sm:text-[13px]"
                    onClick={() => setDraftText(topic.text.trim())}
                  >
                    <span className="line-clamp-3 break-words">{topic.label}</span>
                  </button>
                ))}
          </div>
        </div>
      </section>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <h2 className="text-lg font-semibold text-ink">最近成品</h2>
            <div
              role="tablist"
              aria-label="成品来源"
              className="inline-flex w-max max-w-full shrink-0 rounded-lg border border-line bg-fill/40 p-0.5 text-xs font-medium"
            >
              <button
                type="button"
                role="tab"
                aria-selected={createWorksGalleryTab === "recent"}
                className={[
                  "rounded-md px-2.5 py-1 transition sm:px-3",
                  createWorksGalleryTab === "recent"
                    ? "bg-surface text-ink shadow-sm ring-1 ring-line/60"
                    : "text-muted hover:text-ink"
                ].join(" ")}
                onClick={() => setCreateWorksTabOverride("recent")}
              >
                我的
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={createWorksGalleryTab === "templates"}
                className={[
                  "rounded-md px-2.5 py-1 transition sm:px-3",
                  createWorksGalleryTab === "templates"
                    ? "bg-surface text-ink shadow-sm ring-1 ring-line/60"
                    : "text-muted hover:text-ink"
                ].join(" ")}
                onClick={() => setCreateWorksTabOverride("templates")}
              >
                模板
              </button>
            </div>
          </div>
          <Link href="/works" className="text-xs font-medium text-brand hover:underline sm:shrink-0">
            查看全部
          </Link>
        </div>
        {createWorksGalleryTab === "templates" && templatesErr.trim() ? (
          <p className="mb-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            模板列表加载失败：{templatesErr}
          </p>
        ) : null}
        {createWorksGalleryTab === "recent" && worksErr.trim() ? (
          <p className="mb-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            「我的」列表加载失败：{worksErr}
          </p>
        ) : null}
        <PodcastWorksGallery
          key={createWorksGalleryTab}
          variant="all"
          plainDownloadGate
          works={createWorksGalleryTab === "recent" ? homeWorks.slice(0, 12) : templateGalleryWorks}
          loading={
            (createWorksGalleryTab === "recent" && worksLoading) ||
            (createWorksGalleryTab === "templates" && templatesLoading)
          }
          fetchError={createWorksGalleryTab === "recent" ? worksErr : templatesErr}
          onDismissError={() => {
            if (createWorksGalleryTab === "recent") setWorksErr("");
            else setTemplatesErr("");
          }}
          onWorkDeleted={() => void refreshWorks()}
        />
      </section>
    </main>
  );
}
