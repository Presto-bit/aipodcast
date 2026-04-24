"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PodcastWorksGallery from "../components/podcast/PodcastWorksGallery";
import { IconCreate, IconNotes, IconVoice, IconGrid } from "../components/NavIcons";
import { mergeUserFacingWorksByRecency, type WorkItem } from "../lib/worksTypes";
import { useAuth, userAccountRef } from "../lib/auth";
import { useI18n } from "../lib/I18nContext";
import { isRegisterEmailFormatOk } from "../lib/registerEmail";
import { SiteBeianBar } from "../components/SiteBeianBar";

const HOME_WORKS_LIMIT = 80;
const HOME_WORKS_PREVIEW = 10;

function countQueuedOrRunningJobs(jobs: unknown[] | undefined): number {
  if (!Array.isArray(jobs)) return 0;
  let n = 0;
  for (const row of jobs) {
    if (!row || typeof row !== "object") continue;
    const st = String((row as { status?: unknown }).status || "").trim();
    if (st === "queued" || st === "running") n += 1;
  }
  return n;
}

export default function HomePage() {
  const { t } = useI18n();
  const { ready, authRequired, user, login, registerSendCode, registerVerifyCode, registerComplete, getAuthHeaders } =
    useAuth();
  const homeAccountKey = userAccountRef(user);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regCodeSent, setRegCodeSent] = useState(false);
  const [regOtp, setRegOtp] = useState("");
  const [regDispatchHint, setRegDispatchHint] = useState("");
  const [regSendCodeBusy, setRegSendCodeBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [regA11ySuccess, setRegA11ySuccess] = useState("");
  const [overview, setOverview] = useState({
    latestJobId: "",
    latestJobStatus: "—",
    worksCount: 0,
    notesCount: 0,
    activeJobsCount: 0
  });
  const [homeWorks, setHomeWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksRefreshKey, setWorksRefreshKey] = useState(0);
  const [worksFetchErr, setWorksFetchErr] = useState("");
  /** 避免 accountKey / 依赖连变时多次概览请求乱序覆盖（进行中数量闪错） */
  const homeOverviewReqSeq = useRef(0);

  const refreshHomeOverview = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    const seq = ++homeOverviewReqSeq.current;
    try {
      const authHdr = getAuthHeaders();
      if (!silent) {
        setWorksLoading(true);
        setWorksFetchErr("");
      }
      const [jobsRes, activeJobsRes, worksRes, notesRes] = await Promise.all([
        fetch("/api/jobs?limit=1", { cache: "no-store", credentials: "same-origin", headers: { ...authHdr } }),
        fetch("/api/jobs?limit=80&offset=0&status=queued,running&slim=1", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { ...authHdr }
        }),
        fetch(`/api/works?limit=${HOME_WORKS_LIMIT}&offset=0`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { ...authHdr }
        }),
        fetch("/api/notes", { cache: "no-store", credentials: "same-origin", headers: { ...authHdr } })
      ]);
      const jobsData = (await jobsRes.json().catch(() => ({}))) as { jobs?: Array<{ id?: string; status?: string }> };
      const activeJobsData = (await activeJobsRes.json().catch(() => ({}))) as {
        jobs?: unknown[];
        success?: boolean;
      };
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
        if (!silent) {
          setWorksFetchErr(String(worksData.error || worksData.detail || `作品加载失败 ${worksRes.status}`));
        }
      }
      const latest = Array.isArray(jobsData.jobs) && jobsData.jobs.length > 0 ? jobsData.jobs[0] : null;
      const ai = Array.isArray(worksData.ai) ? worksData.ai : [];
      const tts = Array.isArray(worksData.tts) ? worksData.tts : [];
      const notesWorks = Array.isArray(worksData.notes) ? worksData.notes : [];
      const merged = mergeUserFacingWorksByRecency(ai, tts, notesWorks);
      const activeJobsOk =
        activeJobsRes.ok && activeJobsData.success !== false && Array.isArray(activeJobsData.jobs);
      const activeJobsCount = activeJobsOk ? countQueuedOrRunningJobs(activeJobsData.jobs) : null;

      if (seq !== homeOverviewReqSeq.current) return;

      setHomeWorks(merged);
      setOverview((prev) => ({
        latestJobId: String(latest?.id || "").trim(),
        latestJobStatus: String(latest?.status || "—"),
        worksCount: merged.length,
        notesCount: Array.isArray(notesData.notes) ? notesData.notes.length : 0,
        activeJobsCount: activeJobsCount != null ? activeJobsCount : prev.activeJobsCount
      }));
    } catch {
      if (seq === homeOverviewReqSeq.current && !silent) setWorksFetchErr("加载失败，请稍后重试");
    } finally {
      if (seq === homeOverviewReqSeq.current && !silent) setWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void refreshHomeOverview();
  }, [refreshHomeOverview, worksRefreshKey, homeAccountKey]);

  useEffect(() => {
    if (!user) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshHomeOverview({ silent: true });
    };
    const id = window.setInterval(tick, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshHomeOverview({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user, refreshHomeOverview]);

  useEffect(() => {
    if (!regA11ySuccess) return;
    const t = window.setTimeout(() => setRegA11ySuccess(""), 5000);
    return () => window.clearTimeout(t);
  }, [regA11ySuccess]);

  const quickEntryCards = useMemo(
    () =>
      [
        {
          href: "/notes",
          title: t("home.quickCards.step1.title"),
          desc: t("home.quickCards.step1.desc"),
          Icon: IconNotes
        },
        {
          href: "/create",
          title: t("home.quickCards.step2.title"),
          desc: t("home.quickCards.step2.desc"),
          Icon: IconCreate
        },
        {
          href: "/works",
          title: t("home.quickCards.step3.title"),
          desc: t("home.quickCards.step3.desc"),
          Icon: IconGrid
        },
        {
          href: "/voice?tab=clone",
          title: t("nav.voice"),
          desc: t("home.entryVoice.desc"),
          Icon: IconVoice
        }
      ],
    [t]
  );

  async function sendRegisterCode() {
    setAuthError("");
    setRegA11ySuccess("");
    if (!isRegisterEmailFormatOk(regEmail)) {
      setAuthError("请填写有效的邮箱地址（需含 @ 与域名后缀，如 name@example.com）");
      return;
    }
    setRegSendCodeBusy(true);
    try {
      const sendRes = await registerSendCode({
        email: regEmail.trim().toLowerCase(),
        username: regUsername.trim()
      });
      setRegCodeSent(true);
      setRegOtp("");
      setRegDispatchHint(
        sendRes.devOtpLogged
          ? "当前为日志发码：请到运行编排器的终端查看 [auth] register OTP 行（生产请配置 SMTP 并关闭 FYV_AUTH_EMAIL_LOG_TOKEN）。"
          : ""
      );
      setRegA11ySuccess(
        sendRes.devOtpLogged
          ? "验证码已生成。当前为日志模式，未发送真实邮件，请到服务器日志查看。"
          : "验证码已发送，请查收邮箱。"
      );
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setRegSendCodeBusy(false);
    }
  }

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (authMode === "login") {
      setAuthBusy(true);
      setAuthError("");
      try {
        await login(authPhone.trim(), authPassword);
      } catch (err) {
        setAuthError(String(err instanceof Error ? err.message : err));
      } finally {
        setAuthBusy(false);
      }
      return;
    }
    if (!regCodeSent) {
      setAuthError("请先发送验证码");
      return;
    }
    if (!regOtp.trim()) {
      setAuthError("请填写验证码");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const { registration_ticket } = await registerVerifyCode({
        email: regEmail.trim().toLowerCase(),
        code: regOtp
      });
      await registerComplete({ registration_ticket, password: authPassword });
      setRegCodeSent(false);
      setRegOtp("");
      setRegDispatchHint("");
      setAuthPassword("");
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
      <div className="flex min-h-screen flex-col bg-canvas">
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col p-8">
        <h1 className="text-2xl font-semibold text-ink">Presto</h1>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              authMode === "login"
                ? "bg-surface font-medium text-ink ring-1 ring-brand/35 shadow-sm"
                : "bg-fill text-muted hover:bg-fill hover:text-ink"
            }`}
            onClick={() => {
              setAuthMode("login");
              setAuthError("");
              setRegCodeSent(false);
              setRegOtp("");
              setRegDispatchHint("");
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              authMode === "register"
                ? "bg-surface font-medium text-ink ring-1 ring-brand/35 shadow-sm"
                : "bg-fill text-muted hover:bg-fill hover:text-ink"
            }`}
            onClick={() => {
              setAuthMode("register");
              setAuthError("");
              setRegCodeSent(false);
              setRegOtp("");
              setRegDispatchHint("");
              setAuthPassword("");
            }}
          >
            注册
          </button>
        </div>
        <form className="mt-4 space-y-3" onSubmit={submitAuth}>
          {authMode === "login" ? (
            <input
              className="w-full rounded border border-line bg-canvas p-3 text-sm"
              placeholder="手机号、邮箱或用户名"
              value={authPhone}
              onChange={(e) => setAuthPhone(e.target.value)}
              required
              autoComplete="username"
              aria-label="账号"
            />
          ) : null}
          {authMode === "register" ? (
            <>
              <input
                className="w-full rounded border border-line bg-canvas p-3 text-sm"
                placeholder="账号名称（3～32 位字母、数字或下划线）"
                value={regUsername}
                onChange={(e) => {
                  setRegUsername(e.target.value);
                  setRegCodeSent(false);
                  setRegDispatchHint("");
                }}
                required
                minLength={3}
                maxLength={32}
                autoComplete="username"
                aria-label="账号名称"
              />
              <input
                className="w-full rounded border border-line bg-canvas p-3 text-sm"
                type="email"
                placeholder="邮箱"
                value={regEmail}
                onChange={(e) => {
                  setRegEmail(e.target.value);
                  setRegCodeSent(false);
                  setRegDispatchHint("");
                }}
                required
                autoComplete="email"
                aria-label="邮箱"
              />
              <div className="flex w-full items-stretch overflow-hidden rounded border border-line bg-canvas shadow-sm transition focus-within:border-brand focus-within:ring-1 focus-within:ring-brand/25">
                <input
                  className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2.5 text-sm text-ink outline-none ring-0 placeholder:text-muted focus:ring-0"
                  inputMode="numeric"
                  placeholder="请输入 6 位验证码"
                  value={regOtp}
                  onChange={(e) => setRegOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoComplete="one-time-code"
                  aria-label="验证码"
                />
                <button
                  type="button"
                  className="shrink-0 border-l border-line bg-fill px-3 py-2.5 text-sm text-ink transition hover:bg-canvas disabled:opacity-50"
                  disabled={regSendCodeBusy}
                  onClick={() => void sendRegisterCode()}
                >
                  {regSendCodeBusy ? "提交中…" : regCodeSent ? (regDispatchHint ? "已生成" : "已发送") : "发送验证码"}
                </button>
              </div>
              {regDispatchHint ? <p className="text-xs text-muted">{regDispatchHint}</p> : null}
              <input
                className="w-full rounded border border-line bg-canvas p-3 text-sm"
                type="password"
                placeholder="密码（至少 6 位）"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                autoComplete="new-password"
                aria-label="密码"
              />
            </>
          ) : null}
          {authMode === "login" ? (
            <input
              className="w-full rounded border border-line bg-canvas p-3 text-sm"
              type="password"
              placeholder="密码"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="current-password"
              aria-label="密码"
            />
          ) : null}
          {authError ? (
            <p className="text-sm text-danger-ink" role="alert" aria-live="assertive">
              {authError}
            </p>
          ) : null}
          {authMode === "register" && regA11ySuccess ? (
            <span className="sr-only" aria-live="polite">
              {regA11ySuccess}
            </span>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90 disabled:opacity-50"
            disabled={authBusy}
          >
            {authBusy ? "提交中…" : authMode === "login" ? "登录" : "注册"}
          </button>
          {authMode === "login" ? (
            <p className="text-center text-sm">
              <Link href="/forgot-password" className="text-brand underline underline-offset-2 hover:opacity-90">
                忘记密码
              </Link>
            </p>
          ) : null}
        </form>
        </main>
        <div className="border-t border-line/70 py-4">
          <SiteBeianBar />
        </div>
      </div>
    );
  }

  const isReturningVisitor = overview.worksCount > 0 || overview.activeJobsCount > 0;

  const recentJobHref = overview.latestJobId ? `/jobs/${overview.latestJobId}` : "/jobs";
  const statLinkClass =
    "group block rounded-xl border border-transparent p-2 -m-1 transition-colors hover:border-line/80 hover:bg-fill/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl space-y-6 px-3 pb-12 pt-2 sm:space-y-8 sm:px-4 sm:pt-4">
      <div className="fym-surface-card fym-tech-cap p-5 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          <div className="min-w-0 max-w-xl flex-1">
            {isReturningVisitor ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">欢迎回来</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  查看成品与进行中任务，或开始新稿。长任务无需驻留本页，进度请在「我的作品 → 进行中」查看。
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-3">
                  <Link
                    href="/works"
                    className="inline-flex items-center rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90"
                  >
                    我的作品
                  </Link>
                  <Link
                    href="/works?tab=active"
                    className={`inline-flex items-center rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                      overview.activeJobsCount > 0
                        ? "border-brand/40 bg-brand/8 text-ink hover:bg-brand/12"
                        : "border-line bg-surface text-ink hover:bg-fill"
                    }`}
                  >
                    进行中
                    {overview.activeJobsCount > 0 ? (
                      <span className="ml-1.5 rounded-full bg-brand/18 px-1.5 py-px text-xs tabular-nums text-brand">
                        {overview.activeJobsCount}
                      </span>
                    ) : null}
                  </Link>
                  <Link
                    href="/create"
                    className="inline-flex items-center rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-fill"
                  >
                    开始创作
                  </Link>
                  {overview.latestJobId ? (
                    <Link
                      href={`/jobs/${overview.latestJobId}`}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      打开最近一条任务
                    </Link>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">开始创作</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted">{t("home.schemeB.newUserLead")}</p>
                <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-3">
                  <Link
                    href="/create"
                    className="inline-flex items-center rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90"
                  >
                    开始创作
                  </Link>
                  <Link
                    href="/notes"
                    className="inline-flex items-center rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-fill"
                  >
                    打开知识库
                  </Link>
                  <Link
                    href="/works"
                    className="inline-flex items-center rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-fill"
                  >
                    我的作品
                  </Link>
                  <Link
                    href="/works?tab=active"
                    className="text-sm font-medium text-brand underline decoration-brand/35 underline-offset-2 hover:opacity-90"
                  >
                    进行中
                  </Link>
                </div>
              </>
            )}
          </div>

          <div
            className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-5 text-sm lg:w-52 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0 xl:w-56"
            role="group"
            aria-label="工作台概览"
          >
            <Link href={recentJobHref} className={statLinkClass}>
              <div className="text-xs font-medium text-muted group-hover:text-ink">最近任务</div>
              <div
                className="mt-0.5 truncate font-medium tabular-nums text-ink"
                title={overview.latestJobId || undefined}
              >
                {overview.latestJobId ? `${overview.latestJobId.slice(0, 8)}…` : "—"}
              </div>
            </Link>
            <Link href={recentJobHref} className={statLinkClass}>
              <div className="text-xs font-medium text-muted group-hover:text-ink">状态</div>
              <div className="mt-0.5 font-medium text-ink">{overview.latestJobStatus}</div>
            </Link>
            <Link href="/works" className={statLinkClass}>
              <div className="text-xs font-medium text-muted group-hover:text-ink">成品件数</div>
              <div className="mt-0.5 font-medium tabular-nums text-ink">{overview.worksCount}</div>
            </Link>
            <Link href="/notes" className={statLinkClass}>
              <div className="text-xs font-medium text-muted group-hover:text-ink">笔记篇数</div>
              <div className="mt-0.5 font-medium tabular-nums text-ink">{overview.notesCount}</div>
            </Link>
          </div>
        </div>
      </div>

      <section className="fym-surface-card p-5 sm:p-8" aria-labelledby="home-feature-entry-heading">
        <h2 id="home-feature-entry-heading" className="text-base font-semibold tracking-tight text-ink">
          {t("home.quickCards.sectionTitle")}
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickEntryCards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex flex-col rounded-xl border border-line/80 bg-fill/35 p-4 transition-colors hover:border-brand/35 hover:bg-fill/60 dark:border-line dark:bg-fill/25 dark:hover:bg-fill/40"
            >
              <span
                className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md transition-colors",
                  "bg-fill text-muted group-hover:bg-track group-hover:text-ink"
                ].join(" ")}
                aria-hidden
              >
                <c.Icon className="shrink-0" width={20} height={20} />
              </span>
              <span className="mt-2 font-medium text-ink group-hover:text-brand">{c.title}</span>
              <span className="mt-1 text-sm text-muted">{c.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="fym-surface-card p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2 sm:max-w-[min(100%,28rem)]">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md bg-fill text-muted"
              aria-hidden
            >
              <IconGrid width={20} height={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-ink">
                <Link
                  href="/works"
                  className="rounded-sm outline-offset-2 hover:text-brand hover:underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  最近成品
                </Link>
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                队列与进度 ·
                <Link href="/works?tab=active" className="ml-1 font-medium text-brand hover:underline">
                  进行中
                </Link>
              </p>
            </div>
          </div>
          <Link
            href="/works"
            className="text-sm font-medium text-brand hover:underline"
          >
            去我的作品
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
            showDownloadVipSegment
          />
        </div>
        {!worksLoading && homeWorks.length > HOME_WORKS_PREVIEW ? (
          <p className="mt-2 text-center text-sm text-muted">
            最近 {HOME_WORKS_PREVIEW} 条 ·{" "}
            <Link href="/works" className="font-medium text-brand hover:underline">
              查看全部
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
