import type { ReactNode } from "react";

/** 与 /subscription 同策略；本页多为跳转仍走同一缓存语义。 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MeSubscriptionLayout({ children }: { children: ReactNode }) {
  return children;
}
