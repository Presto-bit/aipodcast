import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Presto · 灵感不设限，创作即刻起",
  description:
    "基于可信资料的多形态创作助手：以电子书、网页、文档为根基，一键生成播客、Shownotes 与博文；带来源引用，减轻幻觉顾虑。"
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}
