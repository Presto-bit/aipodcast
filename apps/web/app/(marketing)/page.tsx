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
            基于可信资料的多形态创作助手
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
            以电子书、网页、文档等自有资料为根基，一键生成播客、Shownotes、博文等可分发内容；答案带来源引用，减轻幻觉顾虑，也减少跨平台排版与重复劳动。
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

        <section
          className="mx-auto mt-16 max-w-5xl sm:mt-20"
          aria-labelledby="marketing-features-heading"
        >
          <h2 id="marketing-features-heading" className="text-center text-lg font-semibold tracking-tight text-ink sm:text-xl">
            核心能力
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5">
            <article className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6">
              <h3 className="text-base font-semibold text-ink">多源资料处理</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                上传电子书、文档、网页等常见资料，Presto 会提炼要点、串联不同主题，并<strong className="font-medium text-ink">仅依据你的资料</strong>
                生成回答与延伸内容。
              </p>
            </article>
            <article className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6">
              <h3 className="text-base font-semibold text-ink">规避 AI 幻觉</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                可放心使用生成结果：关键结论会<strong className="font-medium text-ink">标注引用来源</strong>，便于核对出处，把「可解释」写进工作流。
              </p>
            </article>
            <article className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6">
              <h3 className="text-base font-semibold text-ink">多种输出格式</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                一键生成播客，Shownotes 等繁琐环节交给 Presto；同一批资料还可快速整理为
                <strong className="font-medium text-ink">适合小红书等平台的博文</strong>，少在格式与平台规则上耗时间。
              </p>
            </article>
            <article className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6">
              <h3 className="text-base font-semibold text-ink">多角色与播客级成片</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                支持多角色配音与播客向编排，把「能写」推进到「能听、能发」的成品形态，减少在多套工具间导出、重剪的来回成本。
              </p>
            </article>
          </div>
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
