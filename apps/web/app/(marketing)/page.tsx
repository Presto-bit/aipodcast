"use client";

import Link from "next/link";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";
import BrandGlyph from "../../components/brand/BrandGlyph";
import MarketingHeroIllustration from "../../components/marketing/MarketingHeroIllustration";
import { SiteBeianBar } from "../../components/SiteBeianBar";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";

const SCENARIO_CARDS = [
  {
    title: "播客创作者",
    lines: [
      "无稿想快写稿子：上传电子书、资料等，或直接给出你的观点。",
      "有稿想快出节目：支持设置片头片尾与音色、超长音频；自动 Shownotes、金句，可按文字剪辑。",
      "得到：更快拿到能发的成片和配套文案。"
    ]
  },
  {
    title: "知识博主",
    lines: [
      "先勾选本轮资料为「唯一依据」，再按对标文风写深度稿，并一键改出小红书向短文案。",
      "得到：有料、好读、少空写、少反复洗稿。"
    ]
  },
  {
    title: "备考与研究",
    lines: [
      "厚 PDF / 讲义 / 论文堆在一起：集中提问、要提纲与考点，带引用核对后再记笔记。",
      "得到：吃得快、记得牢、出处心里踏实。"
    ]
  }
] as const;

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
          className="flex items-center gap-3 rounded-lg p-1 transition hover:bg-fill/80 sm:gap-3.5"
          aria-label="访问官网首页"
        >
          <BrandGlyph size={56} className="rounded-xl shadow-soft" />
          <span className="text-base font-semibold tracking-tight sm:text-lg">灵感不设限，创作即刻起</span>
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
        <section className="mx-auto mt-2 grid max-w-6xl gap-10 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,440px)] lg:items-center lg:gap-12 xl:gap-16">
          <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:max-w-none lg:text-left">
            <h1 className="text-balance font-semibold tracking-tight text-ink">
              <span className="block text-lg font-medium leading-snug text-muted sm:text-xl md:text-2xl md:leading-snug">
                基于可信资料
              </span>
              <span className="mt-1 block text-3xl leading-tight sm:mt-1.5 sm:text-4xl md:mt-2 md:text-[2.65rem] md:leading-[1.12]">
                多形态创作助手
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted sm:text-base md:mt-5 md:max-w-3xl lg:mx-0 lg:max-w-3xl">
              以电子书、网页、文档等资料为根基，一键生成文章、播客、Shownotes 等可分发内容；答案带来源引用，减轻幻觉顾虑。
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
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
              <p className="mt-6 text-xs text-muted lg:text-left" aria-live="polite">
                正在加载账号状态…
              </p>
            ) : null}
          </div>
          <div className="mx-auto flex w-full max-w-[480px] justify-center lg:mx-0 lg:max-w-none lg:justify-end">
            <MarketingHeroIllustration />
          </div>
        </section>

        <section
          className="mx-auto mt-16 max-w-5xl sm:mt-20 lg:mt-24"
          aria-labelledby="marketing-scenarios-heading"
        >
          <h2
            id="marketing-scenarios-heading"
            className="text-center text-lg font-semibold tracking-tight text-ink sm:text-xl"
          >
            典型场景
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted md:max-w-3xl">
            对应知识库、创作与成片归档等真实入口；具体以产品内为准。
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-5">
            {SCENARIO_CARDS.map((card) => (
              <article
                key={card.title}
                className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6"
              >
                <h3 className="text-base font-semibold text-ink">{card.title}</h3>
                <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
                  {card.lines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

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
                上传电子书、文档、网页等常见资料，PrestoAI 会提炼要点、串联不同主题，并
                <strong className="font-medium text-ink">仅依据你的资料</strong>
                生成回答与延伸内容。
              </p>
            </article>
            <article className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6">
              <h3 className="text-base font-semibold text-ink">规避 AI 幻觉</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                可放心使用生成结果：关键结论会<strong className="font-medium text-ink">标注引用来源</strong>
                ，便于核对出处，把「可解释」写进工作流。
              </p>
            </article>
            <article className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6">
              <h3 className="text-base font-semibold text-ink">多种输出格式</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                一键生成播客，Shownotes 等繁琐环节交给 PrestoAI；同一批资料还可快速整理为
                <strong className="font-medium text-ink">适合小红书等平台的博文</strong>
                ，少在格式与平台规则上耗时间。
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

      <footer className="relative z-[1] border-t border-line bg-fill/40 px-4 py-6 sm:px-6" role="contentinfo">
        <div className="mx-auto max-w-6xl">
          <SiteBeianBar layout="inline" />
        </div>
      </footer>
    </div>
  );
}
