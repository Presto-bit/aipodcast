"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PodcastWorksGallery from "../../components/podcast/PodcastWorksGallery";
import { IconMic, IconTts } from "../../components/NavIcons";
import PodcastStudio, { type PodcastStudioActivity } from "../../components/studio/PodcastStudio";
import TtsStudio, { type TtsStudioActivity } from "../../components/studio/TtsStudio";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import type { WorkItem } from "../../lib/worksTypes";
import { NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";

type CreateMode = "podcast" | "tts";

const HOME_WORKS_LIMIT = 80;

function mergeWorksByRecency(ai: WorkItem[], tts: WorkItem[], notes: WorkItem[]): WorkItem[] {
  const map = new Map<string, WorkItem>();
  for (const x of [...ai, ...tts, ...notes]) {
    const id = String(x.id || "").trim();
    if (!id) continue;
    if (!map.has(id)) map.set(id, x);
  }
  return [...map.values()].sort((a, b) => {
    const ta = new Date(String(a.createdAt || 0)).getTime();
    const tb = new Date(String(b.createdAt || 0)).getTime();
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
}

const DRAFT_PLACEHOLDER = "输入主题或正文";

export default function CreatePage() {
  const { t } = useI18n();
  const { getAuthHeaders } = useAuth();

  const [draftText, setDraftText] = useState("");
  const [mode, setMode] = useState<CreateMode | null>(null);

  const [podcastAct, setPodcastAct] = useState<PodcastStudioActivity>({ busy: false, phase: "", progressPct: 0 });
  const [ttsAct, setTtsAct] = useState<TtsStudioActivity>({ busy: false, phase: "", progressPct: 0 });

  const [homeWorks, setHomeWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(true);
  const [worksErr, setWorksErr] = useState("");

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
      const merged = mergeWorksByRecency(
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

  const act = mode === "podcast" ? podcastAct : mode === "tts" ? ttsAct : null;
  /** 与 TtsStudio 内嵌一致：仅有 phase、无 progress 数字时也要展示（如校验提示、润色/接口错误文案） */
  const showProgress = Boolean(
    act && (act.busy || (act.phase ?? "").trim().length > 0 || act.progressPct > 0)
  );

  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl px-3 pb-12 pt-3 sm:px-4 sm:pt-6">
      <header className="mb-6 border-l-2 border-brand/35 pl-4 sm:mb-10 sm:pl-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("create.pageEyebrow")}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{t("create.pageTitle")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{t("create.pageSubtitle")}</p>
      </header>

      <section className="fym-surface-card fym-tech-cap overflow-visible">
        <div className="p-4 sm:p-5">
          <label className="sr-only" htmlFor="create-draft">
            创作正文
          </label>
          {/* 文本框 + 模式切换同一视觉块（模式条贴在输入区底部） */}
          <div className="overflow-hidden rounded-xl border border-line bg-fill ring-brand/20 focus-within:ring-2">
            <textarea
              id="create-draft"
              className="min-h-[min(22vh,140px)] w-full resize-y border-0 bg-transparent p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none focus:ring-0 md:min-h-[160px]"
              placeholder={DRAFT_PLACEHOLDER}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
            />
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
              <span className="ml-auto hidden text-xs text-muted sm:inline">{t("create.notesSidebarHint")}</span>
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

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">最近成品</h2>
          <Link href="/works" className="text-xs font-medium text-brand hover:underline">
            查看全部
          </Link>
        </div>
        <PodcastWorksGallery
          variant="all"
          works={homeWorks.slice(0, 12)}
          loading={worksLoading}
          fetchError={worksErr}
          onDismissError={() => setWorksErr("")}
          onWorkDeleted={() => void refreshWorks()}
        />
      </section>
    </main>
  );
}
