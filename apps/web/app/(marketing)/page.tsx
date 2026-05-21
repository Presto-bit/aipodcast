"use client";

import Image from "next/image";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";
import BrandGlyph from "../../components/brand/BrandGlyph";
import {
  IconFeatureCitation,
  IconFeatureFormats,
  IconFeaturePodcast,
  IconFeatureSources,
  IconTrustGift,
  IconTrustQuote,
  IconTrustWallet
} from "../../components/marketing/MarketingFeatureIcons";
import { SiteBeianBar } from "../../components/SiteBeianBar";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";

const SCENARIO_CARDS = [
  {
    title: "播客创作者",
    lines: [
      "无稿想快写稿子：上传电子书、资料等，快速生成播客文稿和音频。",
      "有稿想快出节目：一键转语音，支持设置片头片尾与音色、超长音频，自动 Shownotes、金句。",
      "有音频要剪辑：可按文字剪辑，同时生成 Shownotes。"
    ]
  },
  {
    title: "知识博主",
    lines: [
      "以参考资料为依据，再对标文风写深度稿。",
      "多体裁写作，支持简报、万字长文、小红书文案等。",
      "和参考资料对话以给你灵感。"
    ]
  },
  {
    title: "备考与研究",
    lines: [
      "厚 PDF/讲义/论文堆在一起：集中提问、要提纲与考点，带引用核对后再记笔记。",
      "所有参考资料溯本求源，有理有据。"
    ]
  }
] as const;

type FeatureCard = {
  title: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  body: ReactNode;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    title: "多源资料处理",
    Icon: IconFeatureSources,
    body: (
      <>
        上传电子书、文档、网页等常见资料，PrestoAI 会提炼要点、串联不同主题，并
        <strong className="font-medium text-ink">仅依据你的资料</strong>
        生成回答与延伸内容。
      </>
    )
  },
  {
    title: "规避 AI 幻觉",
    Icon: IconFeatureCitation,
    body: (
      <>
        可放心使用生成结果：关键结论会<strong className="font-medium text-ink">标注引用来源</strong>
        ，便于核对出处，把「可解释」写进工作流。
      </>
    )
  },
  {
    title: "多种输出格式",
    Icon: IconFeatureFormats,
    body: (
      <>
        一键生成播客，Shownotes 等繁琐环节交给 PrestoAI；同一批资料还可快速整理为
        <strong className="font-medium text-ink">适合小红书等平台的博文</strong>
        ，少在格式与平台规则上耗时间。
      </>
    )
  },
  {
    title: "多角色与播客级成片",
    Icon: IconFeaturePodcast,
    body: (
      <>
        支持多角色配音与播客向编排，把「能写」推进到「能听、能发」的成品形态，减少在多套工具间导出、重剪的来回成本。
      </>
    )
  }
];

const TRUST_ITEMS = [
  {
    Icon: IconTrustGift,
    title: "注册即领体验包",
    desc: "一次性赠送 20 分钟语音、20 分钟转写与 1 万字文本额度，先做出第一篇再考虑付费。"
  },
  {
    Icon: IconTrustQuote,
    title: "回答可核对出处",
    desc: "关键结论标注引用来源，便于对照你的资料核对，减轻「AI 瞎编」顾虑。"
  },
  {
    Icon: IconTrustWallet,
    title: "用尽后再按量扣费",
    desc: "体验包用完后按公示单价从余额扣费；价目与流水可在「套餐与余额」页查看。"
  }
] as const;

const REGISTER_HREF = `/register?returnTo=${encodeURIComponent(WORKBENCH_HOME_PATH)}`;

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
                href={REGISTER_HREF}
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
        <section className="mx-auto mt-2 grid max-w-6xl gap-10 lg:mt-4 lg:grid-cols-[1fr_3fr] lg:items-center lg:gap-12 xl:gap-16">
          <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:max-w-none lg:text-left">
            <h1 className="text-balance font-semibold tracking-tight text-ink">
              <span className="block text-lg font-medium leading-snug text-muted sm:text-xl md:text-2xl md:leading-snug">
                基于可信资料
              </span>
              <span className="mt-1 block text-4xl leading-[1.1] sm:mt-1.5 sm:text-5xl md:mt-2 md:text-5xl lg:text-6xl lg:leading-[1.08]">
                <span className="fym-brand-gradient-text">多形态创作助手</span>
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted sm:text-base md:mt-5 md:max-w-3xl lg:mx-0 lg:max-w-3xl">
              以电子书、网页、文档等资料为根基，一键生成文章、播客、Shownotes 等可分发内容；回答带来源引用，减轻幻觉顾虑。
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

            <ul
              className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3 lg:mx-0 lg:max-w-none"
              aria-label="产品承诺"
            >
              {TRUST_ITEMS.map((item) => (
                <li
                  key={item.title}
                  className="flex gap-2.5 rounded-xl border border-line/70 bg-surface/60 px-3 py-3 shadow-soft sm:flex-col sm:items-start sm:gap-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <item.Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted sm:text-xs sm:leading-relaxed">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>

            {!ready ? (
              <p className="mt-6 text-xs text-muted lg:text-left" aria-live="polite">
                正在加载账号状态…
              </p>
            ) : null}
          </div>
          <div className="mx-auto w-3/4 lg:mx-0 lg:w-full">
            <Image
              src="/marketing/hero.png"
              alt="PrestoAI：多格式资料输入，经 AI 分析后输出文章、播客、摘要等内容"
              width={1693}
              height={929}
              priority
              sizes="(max-width: 1024px) 75vw, 75vw"
              className="h-auto w-full rounded-2xl border border-line/90 bg-surface/95 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)]"
            />
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
            {FEATURE_CARDS.map((card) => (
              <article
                key={card.title}
                className="fym-surface-card rounded-2xl border border-line/80 p-5 text-left shadow-soft sm:p-6"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <card.Icon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-ink">{card.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          className="fym-tech-cap fym-surface-card mx-auto mt-16 max-w-5xl rounded-2xl border border-line/80 px-6 py-10 text-center shadow-soft sm:mt-20 sm:px-10 sm:py-12"
          aria-labelledby="marketing-final-cta-heading"
        >
          <h2 id="marketing-final-cta-heading" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            先做出你的第一篇，再决定是否付费
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted">
            注册即领一次性体验包（20 分钟语音、20 分钟转写、1 万字文本）。用尽后按公示单价扣费，价目透明可查。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {loggedIn ? (
              <Link
                href="/create"
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-cta px-6 py-2.5 text-sm font-semibold text-cta-foreground shadow-soft transition hover:bg-cta/90"
              >
                开始创作
              </Link>
            ) : (
              <Link
                href={REGISTER_HREF}
                prefetch={false}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-cta px-6 py-2.5 text-sm font-semibold text-cta-foreground shadow-soft transition hover:bg-cta/90"
              >
                免费注册体验
              </Link>
            )}
            <Link
              href="/subscription"
              prefetch={false}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-surface px-6 py-2.5 text-sm font-semibold text-ink transition hover:bg-fill"
            >
              查看套餐与余额
            </Link>
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
