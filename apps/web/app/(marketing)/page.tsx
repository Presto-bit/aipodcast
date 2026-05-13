"use client";

import Link from "next/link";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";
import BrandGlyph from "../../components/brand/BrandGlyph";
import { SiteBeianBar } from "../../components/SiteBeianBar";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";

export default function MarketingLandingPage() {
  const { ready, authRequired, user } = useAuth();
  const loggedIn = ready && authRequired && isLoggedInAccountUser(user);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-canvas text-ink">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[min(52vh,520px)] bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(59,130,246,0.18),transparent_55%)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(96,165,250,0.14),transparent_55%)]"
        aria-hidden
      />
      <header className="relative z-[1] mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pb-8 sm:pt-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-fill/80"
          aria-label="Presto"
        >
          <BrandGlyph size={40} className="rounded-md shadow-soft" />
          <span className="text-base font-semibold tracking-tight sm:text-lg">Presto</span>
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-3" aria-label="营销页导航">
          <Link
            href="/subscription"
            prefetch={false}
            className="text-sm font-medium text-muted transition hover:text-ink"
          >
            套餐与余额
          </Link>
          {loggedIn ? (
            <Link
              href={WORKBENCH_HOME_PATH}
              className="inline-flex items-center rounded-lg bg-cta px-3.5 py-2 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90 sm:px-4"
            >
              进入工作台
            </Link>
          ) : (
            <>
              <Link
                href={`/login?returnTo=${encodeURIComponent(WORKBENCH_HOME_PATH)}`}
                prefetch={false}
                className="text-sm font-medium text-muted transition hover:text-ink"
              >
                登录
              </Link>
              <Link
                href={`/register?returnTo=${encodeURIComponent(WORKBENCH_HOME_PATH)}`}
                prefetch={false}
                className="inline-flex items-center rounded-lg bg-cta px-3.5 py-2 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90 sm:px-4"
              >
                注册
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="relative z-[1] mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-[2.75rem] md:leading-tight">
            把内容变成可发布播客
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
            从选题、脚本到多角色配音与剪辑导出，在同一工作台完成播客制作。适合创作者团队与个人频道。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/create"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-cta-foreground shadow-soft transition hover:bg-cta/90"
            >
              开始生成播客
            </Link>
            <Link
              href={WORKBENCH_HOME_PATH}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-fill"
            >
              工作台首页
            </Link>
          </div>
          {!ready ? (
            <p className="mt-6 text-xs text-muted" aria-live="polite">
              正在加载账号状态…
            </p>
          ) : null}
        </div>

        <section className="mx-auto mt-16 grid max-w-4xl gap-4 sm:mt-20 sm:grid-cols-3 sm:gap-5">
          {[
            { t: "多形态创作", d: "播客、口播剪辑与音色库协同，减少工具切换。" },
            { t: "任务可追踪", d: "长任务后台运行，在「我的作品」查看进度与成片。" },
            { t: "订阅透明", d: "套餐与用量说明见订阅页，按需使用。" }
          ].map((card) => (
            <div key={card.t} className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft">
              <h2 className="text-sm font-semibold text-ink">{card.t}</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">{card.d}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative z-[1] border-t border-line bg-fill/40 px-4 py-8 sm:px-6" role="contentinfo">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center">
          <p className="text-xs text-muted">Presto — 灵感不设限，创作即刻起</p>
          <SiteBeianBar />
        </div>
      </footer>
    </div>
  );
}
