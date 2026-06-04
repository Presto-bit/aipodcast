"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconClip, IconMic, IconRotateCw, IconShownotes, IconTts } from "../../../components/icons";
import type { PodcastStudioActivity } from "../../../components/studio/PodcastStudio";
import type { TtsStudioActivity } from "../../../components/studio/TtsStudio";
import WorkbenchDynamicLoading from "../../../components/nav/WorkbenchDynamicLoading";

const studioLoadingShell = (label: string, minH: string) => (
  <WorkbenchDynamicLoading>
    <div className={`${minH} rounded-xl border border-line/50 bg-fill/40`} aria-busy aria-label={label} />
  </WorkbenchDynamicLoading>
);

const PodcastStudio = dynamic(() => import("../../../components/studio/PodcastStudio"), {
  loading: () => studioLoadingShell("加载播客工作室", "min-h-[200px]")
});
const TtsStudio = dynamic(() => import("../../../components/studio/TtsStudio"), {
  loading: () => studioLoadingShell("加载语音合成工作室", "min-h-[180px]")
});
const PodcastWorksGallery = dynamic(() => import("../../../components/podcast/PodcastWorksGallery"), {
  loading: () => studioLoadingShell("加载作品列表", "min-h-[120px] rounded-2xl")
});
const WorksGroupedGalleryPanel = dynamic(
  () => import("../../../components/works/WorksGroupedGalleryPanel"),
  {
    loading: () => studioLoadingShell("加载作品列表", "min-h-[120px] rounded-2xl")
  }
);
import { isLoggedInAccountUser, useAuth } from "../../../lib/auth";
import { apiErrorMessage, softenBareErrorLineForUi } from "../../../lib/apiError";
import { useI18n } from "../../../lib/I18nContext";
import { mergeUserFacingWorksByRecency, type WorkItem } from "../../../lib/worksTypes";
import { NOTES_PODCAST_PROJECT_NAME } from "../../../lib/notesProject";
import { isAbortError, usePageAbortSignal, usePageFetch } from "../../../lib/usePageAbortSignal";
import { useCreateRecentWorksQuery, useInvalidateWorksOnMutation } from "../../../lib/queries/worksQueries";
import { messageSuggestsBillingTopUpOrSubscription } from "../../../lib/billingShortfall";
import { BillingShortfallLinks } from "../../../components/subscription/BillingShortfallLinks";
import { CreatePodcastStudioIdleShell, CreateTtsStudioIdleShell } from "../../../components/studio/CreateStudioIdleShell";
import { marketingSiteUrl } from "../../../lib/marketingSiteUrl";
import { consumeComposerHandoff, type ComposerHandoff } from "../../../lib/composerHandoff";
import { buildWorksTabHref, filterTtsWorks } from "../../../lib/workGalleryDisplay";

type HotTopicAssistantItem = { label: string; text: string };

type CreateWorksTab = "recent" | "templates";

type CreateMode = "podcast" | "tts";

const HOME_WORKS_LIMIT = 80;

function parseUrlMode(raw: string | null | undefined): CreateMode | null {
  const m = String(raw || "").trim().toLowerCase();
  if (m === "tts") return "tts";
  if (m === "podcast") return "podcast";
  return null;
}

function createReturnPath(mode: CreateMode | null): string {
  if (mode === "tts") return "/create?mode=tts";
  if (mode === "podcast") return "/create?mode=podcast";
  return "/create";
}

export default function CreatePage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const urlMode = parseUrlMode(searchParams?.get("mode"));
  const isHandoffEntry = searchParams?.get("handoff") === "1";
  const { user, getAuthHeaders } = useAuth();
  const isLoggedIn = useMemo(() => isLoggedInAccountUser(user), [user]);
  const pageAbortSignal = usePageAbortSignal();
  const pageFetch = usePageFetch(pageAbortSignal);
  const worksQuery = useCreateRecentWorksQuery(getAuthHeaders, isLoggedIn, NOTES_PODCAST_PROJECT_NAME, HOME_WORKS_LIMIT);
  const invalidateWorks = useInvalidateWorksOnMutation();

  const [draftText, setDraftText] = useState("");
  const [libraryPreview, setLibraryPreview] = useState("");
  const [mode, setMode] = useState<CreateMode | null>(urlMode);
  const [handoffCtx, setHandoffCtx] = useState<ComposerHandoff | null>(null);

  useLayoutEffect(() => {
    setMode(urlMode);
  }, [urlMode]);

  useEffect(() => {
    if (!isHandoffEntry) return;
    const pkg = consumeComposerHandoff();
    if (!pkg) return;
    setHandoffCtx(pkg);
    const script = String(pkg.scriptText || "").trim();
    if (script) setDraftText(script);
  }, [isHandoffEntry]);
  /**
   * 访客首屏先渲染轻量工具条壳，再在浏览器空闲时挂载真实 Studio，兼顾「看得见工具条」与进页轻量。
   */
  const [guestHeavyStudioReady, setGuestHeavyStudioReady] = useState(false);

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

  useLayoutEffect(() => {
    if (isLoggedIn) return;
    setGuestHeavyStudioReady(false);
    let cancelled = false;
    const arm = () => {
      if (!cancelled) setGuestHeavyStudioReady(true);
    };
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(arm, { timeout: 720 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const tid = window.setTimeout(arm, 32);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [isLoggedIn]);

  const loadHeavyStudio = isLoggedIn || guestHeavyStudioReady;

  const fetchHotTopics = useCallback(async (seed: number, opts?: { preserveOnError?: boolean }) => {
    setHotTopicsLoading(true);
    setHotTopicsErr("");
    try {
      const res = await pageFetch(`/api/create/hot-topics?seed=${encodeURIComponent(String(seed))}`, {
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
      if (isAbortError(e)) return;
      const msg = String(e instanceof Error ? e.message : e);
      if (opts?.preserveOnError) {
        setHotTopicsErr(msg);
        return;
      }
      setHotTopics([]);
      setHotTopicsErr(msg);
    } finally {
      if (!pageAbortSignal.aborted) setHotTopicsLoading(false);
    }
  }, [pageAbortSignal, pageFetch]);

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
    await invalidateWorks();
    await worksQuery.refetch();
  }, [invalidateWorks, worksQuery]);

  useEffect(() => {
    if (!isLoggedIn) {
      setHomeWorks([]);
      setWorksLoading(false);
      setWorksErr("");
      return;
    }
    const hasWorks = Boolean(worksQuery.filteredWorks?.length || worksQuery.data);
    setWorksLoading(worksQuery.isLoading && !hasWorks);
    if (worksQuery.filteredWorks) {
      setHomeWorks(worksQuery.filteredWorks);
      setWorksErr("");
    }
    if (worksQuery.isError && !hasWorks) {
      setWorksErr(String(worksQuery.error instanceof Error ? worksQuery.error.message : worksQuery.error));
      setHomeWorks([]);
    }
  }, [isLoggedIn, worksQuery.filteredWorks, worksQuery.data, worksQuery.error, worksQuery.isError, worksQuery.isLoading]);

  const refreshPodcastTemplates = useCallback(async () => {
    setTemplatesErr("");
    setTemplatesLoading(true);
    try {
      const res = await pageFetch("/api/works/podcast-templates?limit=40&offset=0", {
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
        throw new Error(apiErrorMessage(data, `模板加载失败（${res.status}）`));
      }
      setServerPodcastTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (e) {
      if (isAbortError(e)) return;
      setTemplatesErr(String(e instanceof Error ? e.message : e));
      setServerPodcastTemplates([]);
    } finally {
      if (!pageAbortSignal.aborted) setTemplatesLoading(false);
    }
  }, [getAuthHeaders, pageAbortSignal, pageFetch]);

  /** 全站播客模板列表公开可读；TTS 页不需要模板 */
  useEffect(() => {
    if (urlMode === "tts" || mode === "tts") return;
    void refreshPodcastTemplates();
  }, [refreshPodcastTemplates, urlMode, mode]);

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
  const isTtsPage = urlMode === "tts" || mode === "tts";
  const isPodcastPage = urlMode === "podcast" || mode === "podcast";
  const pageTitle = isTtsPage
    ? t("create.tts.pageTitle")
    : isPodcastPage
      ? t("create.podcast.pageTitle")
      : t("create.pageTitle");
  const pageSubtitle = isTtsPage
    ? t("create.tts.pageSubtitle")
    : isPodcastPage
      ? t("create.podcast.pageSubtitle")
      : t("create.pageSubtitle").trim();
  const draftPlaceholder = isTtsPage
    ? t("create.tts.placeholder")
    : isPodcastPage
      ? t("create.podcast.placeholder")
      : t("create.podcast.placeholder");
  const isLockedStudioPage = urlMode === "podcast" || urlMode === "tts";
  const showModeChips = !isLockedStudioPage;
  const showHotTopicAssistant = urlMode !== "podcast" && !isTtsPage;
  const showTemplatesTab = !isTtsPage;
  const createReturnTo = createReturnPath(urlMode ?? mode);

  useEffect(() => {
    document.title = `${pageTitle} · Presto`;
  }, [pageTitle]);

  const createWorksGalleryTab: CreateWorksTab =
    !showTemplatesTab
      ? "recent"
      : createWorksTabOverride ??
        (!isLoggedIn
          ? "templates"
          : worksLoading
            ? "recent"
            : homeWorks.length > 0
              ? "recent"
              : "templates");

  const galleryRecentWorks = useMemo(
    () => (isTtsPage ? filterTtsWorks(homeWorks) : homeWorks),
    [homeWorks, isTtsPage]
  );

  const worksViewAllHref = useMemo(
    () =>
      isTtsPage
        ? buildWorksTabHref("audio", createReturnTo, { kind: "tts" })
        : buildWorksTabHref("audio", createReturnTo),
    [createReturnTo, isTtsPage]
  );

  const templateGalleryWorks = useMemo(() => [...serverPodcastTemplates], [serverPodcastTemplates]);

  const shownotesMarketingUrl = useMemo(() => {
    const base = marketingSiteUrl().replace(/\/$/, "");
    return `${base}/shownotes`;
  }, []);

  const createQuickLinkClass =
    "inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-brand/30 hover:bg-fill sm:text-sm";

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-12 pt-3 sm:px-4 sm:pt-6">
      <div
        className={[
          "mx-auto w-full",
          mode ? "max-w-[min(100%,59.5rem)]" : "max-w-3xl"
        ].join(" ")}
      >
      <header className="mb-6 sm:mb-10">
        {handoffCtx ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2 text-sm">
            <span className="font-medium text-brand">{t("create.handoff.banner")}</span>
            <Link href={handoffCtx.returnTo || "/home"} className="text-brand underline decoration-brand/40 underline-offset-2 hover:opacity-90">
              {t("create.handoff.back")}
            </Link>
          </div>
        ) : null}
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
          {pageTitle}
        </h1>
        {pageSubtitle ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{pageSubtitle}</p>
        ) : null}
      </header>

      <div className={mode ? "mb-3 w-full" : ""}>
        <div className="w-full max-w-3xl">
            <section className="fym-surface-card overflow-visible">
        <div className="p-4 sm:p-5">
          <label className="sr-only" htmlFor="create-draft">
            {draftPlaceholder}
          </label>
          <div className="overflow-hidden rounded-xl bg-fill ring-brand/20 focus-within:ring-2">
            <div className="relative">
              <textarea
                id="create-draft"
                className={[
                  "min-h-[min(22vh,140px)] w-full resize-y border-0 bg-transparent p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none focus:ring-0 md:min-h-[160px]",
                  libraryPreview.trim() ? "pb-14 sm:pb-16" : "pb-4"
                ].join(" ")}
                placeholder={draftPlaceholder}
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
            {showModeChips ? (
            <div className="flex flex-wrap items-center gap-2 bg-surface/95 px-3 py-2.5 backdrop-blur-sm">
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
              {!mode ? (
                <>
                  <Link href="/clip" className={createQuickLinkClass}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-fill text-muted">
                      <IconClip width={16} height={16} />
                    </span>
                    {t("create.quickLink.clip")}
                  </Link>
                  <a href={shownotesMarketingUrl} className={createQuickLinkClass}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-fill text-muted">
                      <IconShownotes width={16} height={16} />
                    </span>
                    {t("create.quickLink.shownotes")}
                  </a>
                </>
              ) : null}
            </div>
            ) : null}
          </div>

          {!mode ? null : (
            <div className="mt-4">
              {mode === "podcast" ? (
                loadHeavyStudio ? (
                  <PodcastStudio
                    key="podcast-studio"
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
                  <CreatePodcastStudioIdleShell />
                )
              ) : loadHeavyStudio ? (
                <TtsStudio
                  key="tts-studio"
                  embedded
                  blendOuterCard
                  contentText={draftText}
                  onContentTextChange={setDraftText}
                  hideGenerateButton={false}
                  showGallery={false}
                  onActivityChange={setTtsAct}
                  onExternalListRefresh={() => void refreshWorks()}
                />
              ) : (
                <CreateTtsStudioIdleShell />
              )}
            </div>
          )}
        </div>

        {mode && showProgress && act ? (
          <div className="bg-fill/60 px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-muted">状态</p>
            <p className="mt-1 text-sm text-ink">
              {softenBareErrorLineForUi(act.phase || "") || (act.busy ? "处理中…" : "—")}
            </p>
            {messageSuggestsBillingTopUpOrSubscription(softenBareErrorLineForUi(act.phase || "")) ? (
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
              <Link href="/works?tab=active" className="font-medium text-brand hover:underline">
                我的作品
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      {showHotTopicAssistant ? (
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
            <IconChevronDown
              width={16}
              height={16}
              className={`shrink-0 text-muted transition-transform duration-200 ${hotTopicAssistantOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </button>
        <div
          id="create-hot-topic-panel"
          hidden={!hotTopicAssistantOpen}
          className="border-t border-line px-3 pb-3 pt-2 sm:px-4"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="max-w-[min(100%,28rem)] text-[11px] leading-snug text-muted">
              点击卡片填入「从该热点可聊的角度」选题备忘，再自行决定是否扩写成整期播客。
            </p>
            <button
              type="button"
              disabled={hotTopicsLoading}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-fill/50 text-muted transition hover:border-brand/40 hover:bg-brand/10 hover:text-brand disabled:pointer-events-none disabled:opacity-40"
              title="换一批"
              aria-label="换一批"
              onClick={() => refreshHotTopics()}
            >
              <IconRotateCw
                width={14}
                height={14}
                aria-hidden
                className={hotTopicsLoading ? "animate-spin" : ""}
              />
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
      ) : null}

        </div>
      </div>
    </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <h2 className="text-lg font-semibold text-ink">{isTtsPage ? t("create.tts.recentTitle") : "最近成品"}</h2>
            {showTemplatesTab ? (
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
            ) : null}
          </div>
          <Link
            href={worksViewAllHref}
            className="text-xs font-medium text-brand hover:underline sm:shrink-0"
          >
            查看全部
          </Link>
        </div>
        {createWorksGalleryTab === "templates" && templatesErr.trim() ? (
          <p className="mb-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            模板列表加载失败：{softenBareErrorLineForUi(templatesErr)}
          </p>
        ) : null}
        {createWorksGalleryTab === "recent" && worksErr.trim() ? (
          <p className="mb-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            「我的」列表加载失败：{softenBareErrorLineForUi(worksErr)}
          </p>
        ) : null}
        {createWorksGalleryTab === "recent" ? (
          isTtsPage ? (
            <PodcastWorksGallery
              variant="tts"
              works={galleryRecentWorks}
              loading={worksLoading}
              fetchError={worksErr}
              onDismissError={() => setWorksErr("")}
              onWorkDeleted={() => void refreshWorks()}
              workDetailReturnTo={createReturnTo}
              sidebarMaxItems={4}
            />
          ) : (
          <WorksGroupedGalleryPanel
            works={galleryRecentWorks}
            loading={worksLoading}
            fetchError={worksErr}
            onDismissError={() => setWorksErr("")}
            onWorkDeleted={() => void refreshWorks()}
            returnTo={createReturnTo}
            maxPerGroup={4}
            emptyHint="暂无成片；完成播客或语音合成后将显示在这里（不含知识库笔记本内产出）。"
          />
          )
        ) : (
          <PodcastWorksGallery
            key="templates"
            variant="all"
            works={templateGalleryWorks}
            loading={templatesLoading}
            fetchError={templatesErr}
            onDismissError={() => setTemplatesErr("")}
            onWorkDeleted={() => void refreshWorks()}
            workDetailReturnTo={createReturnTo}
            emptyStateFooter={
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                {!isLoggedIn ? (
                  <Link
                    href={`/login?returnTo=${encodeURIComponent(createReturnTo)}`}
                    className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:opacity-90"
                  >
                    登录后保存与查看成片
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/notes"
                      className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:opacity-90"
                    >
                      去知识库添加资料
                    </Link>
                    <Link href="/help" className="font-medium text-muted underline underline-offset-2 hover:text-ink">
                      使用帮助
                    </Link>
                  </>
                )}
              </div>
            }
          />
        )}
      </section>
    </main>
  );
}
