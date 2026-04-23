import type { ReactNode } from "react";

/** 订阅 / 价格 / 支付入口：与根 layout 一致并显式声明，便于审计与后续在该段加 RSC。 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SubscriptionLayout({ children }: { children: ReactNode }) {
  return children;
}
