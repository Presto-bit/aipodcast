import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Presto · 灵感不设限，创作即刻起",
  description: "Presto — 语音与播客创作：把内容变成可发布播客，从灵感到成品一站完成。"
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}
