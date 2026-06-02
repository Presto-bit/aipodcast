import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PrestoAI · 灵感不设限，创作即刻起",
  description:
    "以电子书、网页、文档等资料为根基，一键生成文章、播客、Shownotes 等可分发内容；回答带来源引用，减轻幻觉顾虑。"
};

/** 营销落地：ISR/静态，不在此段 layout 读取 Cookie（Providers 在根 layout） */
export const revalidate = 3600;

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preload" as="image" href="/marketing/hero.webp" fetchPriority="high" />
      {children}
    </>
  );
}
