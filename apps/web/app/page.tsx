"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PodcastWorksGallery from "../components/podcast/PodcastWorksGallery";
import { IconNotes, IconTts, IconVoice, IconGrid } from "../components/NavIcons";
import type { WorkItem } from "../lib/worksTypes";
import { useAuth } from "../lib/auth";

const HOME_WORKS_LIMIT = 80;
const HOME_WORKS_PREVIEW = 10;

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

export default function HomePage() {
  const { ready, authRequired, user, login, register, getAuthHeaders } = useAuth();
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [overview, setOverview] = useState({
    latestJobId: "",
    latestJobStatus: "暂无",
    worksCount: 0,
    notesCount: 0
  });
  const [homeWorks, setHomeWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksRefreshKey, setWorksRefreshKey] = useState(0);
  const [worksFetchErr, setWorksFetchErr] = useState("");

  const refreshHomeOverview = useCallback(async () => {
    try {
      const authHdr = getAuthHeaders();
      setWorksLoading(true);
      setWorksFetchErr("");
      const [jobsRes, worksRes, notesRes] = await Promise.all([
        fetch("/api/jobs?limit=1", { cache: "no-store", credentials: "same-origin", headers: { ...authHdr } }),
        fetch(`/api/works?limit=${HOME_WORKS_LIMIT}&offset=0`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { ...authHdr }
        }),
        fetch("/api/notes", { cache: "no-store", credentials: "same-origin", headers: { ...authHdr } })
      ]);
      const jobsData = (await jobsRes.json().catch(() => ({}))) as { jobs?: Array<{ id?: string; status?: string }> };
      const worksData = (await worksRes.json().catch(() => ({}))) as {
        ai?: WorkItem[];
        tts?: WorkItem[];
        notes?: WorkItem[];
        success?: boolean;
        error?: string;
        detail?: string;
      };
      const notesData = (await notesRes.json().catch(() => ({}))) as { notes?: unknown[] };
      if (!worksRes.ok || worksData.success === false) {
        setWorksFetchErr(String(worksData.error || worksData.detail || `作品加载失败 ${worksRes.status}`));
      }
      const latest = Array.isArray(jobsData.jobs) && jobsData.jobs.length > 0 ? jobsData.jobs[0] : null;
      const ai = Array.isArray(worksData.ai) ? worksData.ai : [];
      const tts = Array.isArray(worksData.tts) ? worksData.tts : [];
      const notesWorks = Array.isArray(worksData.notes) ? worksData.notes : [];
      const merged = mergeWorksByRecency(ai, tts, notesWorks);
      setHomeWorks(merged);
      setOverview({
        latestJobId: String(latest?.id || "").trim(),
        latestJobStatus: String(latest?.status || "暂无"),
        worksCount: merged.length,
        notesCount: Array.isArray(notesData.notes) ? notesData.notes.length : 0
      });
    } catch {
      setWorksFetchErr("加载失败，请稍后重试");
    } finally {
      setWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void refreshHomeOverview();
  }, [refreshHomeOverview, worksRefreshKey]);

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "login") {
        await login(authPhone.trim(), authPassword);
      } else {
        await register(authPhone.trim(), authPassword, inviteCode.trim());
      }
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setAuthBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl p-8">
        <p className="text-sm text-muted">正在加载…</p>
      </main>
    );
  }

  if (authRequired && !user) {
    return (
      <main className="mx-auto min-h-screen max-w-md p-8">
        <h1 className="text-2xl font-semibold">Finding Your Voice</h1>
        <p className="mt-2 text-sm text-muted">使用手机号即可登录或注册</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className={`rounded px-3 py-1 text-sm ${authMode === "login" ? "bg-blue-600" : "bg-fill"}`}
            onClick={() => setAuthMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1 text-sm ${authMode === "register" ? "bg-blue-600" : "bg-fill"}`}
            onClick={() => setAuthMode("register")}
          >
            注册
          </button>
        </div>
        <form className="mt-4 space-y-3" onSubmit={submitAuth}>
          <input
            className="w-full rounded border border-line bg-canvas p-3 text-sm"
            placeholder="手机号"
            value={authPhone}
            onChange={(e) => setAuthPhone(e.target.value)}
            required
          />
          <input
            className="w-full rounded border border-line bg-canvas p-3 text-sm"
            type="password"
            placeholder="密码"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            required
            minLength={6}
          />
          {authMode === "register" ? (
            <input
              className="w-full rounded border border-line bg-canvas p-3 text-sm"
              placeholder="邀请码（注册需要）"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
            />
          ) : null}
          {authError ? <p className="text-sm text-rose-300">{authError}</p> : null}
          <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 text-sm disabled:opacity-50" disabled={authBusy}>
            {authBusy ? "提交中..." : authMode === "login" ? "登录" : "注册"}
          </button>
        </form>
      </main>
    );
  }

  const createCards = [
    { href: "/tts", title: "文本转语音", desc: "把文字变成自然流畅的人声", Icon: IconTts, badge: undefined },
    { href: "/notes", title: "笔记转播客", desc: "读书笔记、会议纪要一键变成节目", Icon: IconNotes, badge: undefined },
    {
      href: "/voice?tab=clone",
      title: "复刻我的声音",
      desc: "几分钟完成声音采样，随时用你的音色做语音合成",
      Icon: IconVoice,
      badge: undefined
    }
  ] as const;

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 pt-1 sm:px-4">
      <div className="mb-5 rounded-2xl border border-line bg-gradient-to-br from-surface to-fill p-5 shadow-sm sm:p-6">
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">把内容变成可发布播客</h1>
            <p className="mt-2 text-sm text-muted">上传或粘贴内容，几分钟生成音频与文案。</p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Link
                href="/podcast"
                className="inline-flex items-center rounded-lg bg-cta px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-cta/90"
              >
                开始生成播客
              </Link>
              <Link
                href="/works"
                className="inline-flex items-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill"
              >
                查看我的作品
              </Link>
              {overview.latestJobId ? (
                <Link
                  href={`/jobs/${overview.latestJobId}`}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  继续上次任务
                </Link>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-muted">3 步完成首次生成：输入内容 → 选择风格 → 开始生成</p>
          </div>
          <div className="grid min-w-[230px] grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-line bg-white/80 px-3 py-2">
              <p className="text-muted">最近任务</p>
              <p className="mt-1 truncate font-medium text-ink">
                {overview.latestJobId ? `${overview.latestJobId.slice(0, 8)}…` : "还没有"}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-white/80 px-3 py-2">
              <p className="text-muted">进度</p>
              <p className="mt-1 font-medium text-ink">{overview.latestJobStatus}</p>
            </div>
            <div className="rounded-lg border border-line bg-white/80 px-3 py-2">
              <p className="text-muted">已发布作品</p>
              <p className="mt-1 font-medium text-ink">{overview.worksCount}</p>
            </div>
            <div className="rounded-lg border border-line bg-white/80 px-3 py-2">
              <p className="text-muted">我的笔记</p>
              <p className="mt-1 font-medium text-ink">{overview.notesCount}</p>
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">更多创作工具</h2>
          <span className="text-xs text-muted">常用入口</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {createCards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand/40 hover:bg-fill"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={[
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md transition-colors",
                    "bg-fill text-muted group-hover:bg-track group-hover:text-ink"
                  ].join(" ")}
                  aria-hidden
                >
                  <c.Icon className="shrink-0" width={20} height={20} />
                </span>
                {c.badge ? <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] text-brand">{c.badge}</span> : null}
              </div>
              <span className="mt-2 font-medium text-ink group-hover:text-brand">{c.title}</span>
              <span className="mt-1 text-xs text-muted">{c.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md bg-fill text-muted"
              aria-hidden
            >
              <IconGrid width={20} height={20} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">我的作品</h2>
              <p className="text-xs text-muted">全部类型合并，按生成时间从新到旧</p>
            </div>
          </div>
          <Link
            href="/works"
            className="text-xs font-medium text-brand hover:underline"
          >
            查看全部
          </Link>
        </div>
        <div className="mt-4">
          <PodcastWorksGallery
            variant="all"
            works={homeWorks.slice(0, HOME_WORKS_PREVIEW)}
            loading={worksLoading}
            fetchError={worksFetchErr}
            onDismissError={() => setWorksFetchErr("")}
            onWorkDeleted={() => setWorksRefreshKey((k) => k + 1)}
          />
        </div>
        {!worksLoading && homeWorks.length > HOME_WORKS_PREVIEW ? (
          <p className="mt-2 text-center text-xs text-muted">
            仅展示最近 {HOME_WORKS_PREVIEW} 条，
            <Link href="/works" className="ml-1 font-medium text-brand hover:underline">
              在「我的作品」查看全部
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
