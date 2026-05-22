"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";
import BrandGlyph from "../../components/brand/BrandGlyph";
import MarketingFeatureCard from "../../components/marketing/MarketingFeatureCard";
import { SiteBeianBar } from "../../components/SiteBeianBar";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";

type FeatureCard = {
  title: string;
  imageSrc: string;
  imageAlt: string;
  body: ReactNode;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    title: "多源资料处理",
    imageSrc: "/marketing/features/sources.png",
    imageAlt: "多源资料处理：电子书、文档、网页等汇入 PrestoAI，提炼要点并串联主题",
    body: (
      <>
        常见格式一次接入，要点与主题自动串联；回答与延伸内容
        <strong className="font-medium text-ink">严格 grounded 在你的资料</strong>，不凭空编造。
      </>
    )
  },
  {
    title: "规避 AI 幻觉",
    imageSrc: "/marketing/features/citation.png",
    imageAlt: "规避 AI 幻觉：回答附带 PDF、文档、网页等来源引用，便于核对",
    body: (
      <>
        关键结论带可点击的<strong className="font-medium text-ink">来源标注</strong>
        ，从生成到核对一条链路，把可解释性写进日常工作流。
      </>
    )
  },
  {
    title: "多种输出格式",
    imageSrc: "/marketing/features/formats.png",
    imageAlt: "多种输出格式：同一批资料可生成播客、Shownotes、文章与小红书等平台内容",
    body: (
      <>
        同一批资料可分支为播客、Shownotes、长文与
        <strong className="font-medium text-ink">小红书等平台博文</strong>，少在格式转换上反复折腾。
      </>
    )
  },
  {
    title: "多角色与播客级成片",
    imageSrc: "/marketing/features/podcast.png",
    imageAlt: "多角色与播客级成片：多轨配音、片头片尾与可发布成品",
    body: (
      <>
        多角色配音与播客向编排，从「能写」到<strong className="font-medium text-ink">能听、能发</strong>
        ；减少在多套工具间导出、重剪的来回。
      </>
    )
  }
];

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
          <div className="mt-8">
            <Image
              src="/marketing/scenario-cards.png"
              alt="典型场景：播客创作者、知识博主、个人知识库"
              width={1280}
              height={720}
              sizes="(max-width: 1280px) 100vw, 1280px"
              className="h-auto w-full rounded-2xl border border-line/80 shadow-soft"
            />
          </div>
        </section>

        <section
          className="mx-auto mt-16 max-w-5xl sm:mt-20"
          aria-labelledby="marketing-features-heading"
        >
          <h2 id="marketing-features-heading" className="text-center text-lg font-semibold tracking-tight text-ink sm:text-xl">
            核心能力
          </h2>
          <div className="mt-8 flex flex-col gap-12 sm:gap-14">
            {FEATURE_CARDS.map((card) => (
              <MarketingFeatureCard
                key={card.title}
                title={card.title}
                body={card.body}
                imageSrc={card.imageSrc}
                imageAlt={card.imageAlt}
              />
            ))}
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
