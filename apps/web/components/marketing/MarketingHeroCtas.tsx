"use client";

import Link from "next/link";
import { marketingFinanceNotebookHref } from "../../lib/marketingNotebookLinks";
import { trackFunnelEvent } from "../../lib/funnelAnalytics";

const GUEST_TRY_PODCAST_HREF = "/create?mode=podcast";
const FINANCE_NOTEBOOK_HREF = marketingFinanceNotebookHref();

type Props = {
  registerHref: string;
};

export default function MarketingHeroCtas({ registerHref }: Props) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
      <Link
        href={FINANCE_NOTEBOOK_HREF}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-fill"
      >
        体验笔记本
      </Link>
      <Link
        href={GUEST_TRY_PODCAST_HREF}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-cta-foreground shadow-soft transition hover:bg-cta/90"
        onClick={() => void trackFunnelEvent("marketing_cta_listen")}
      >
        试听播客
      </Link>
      <Link
        href={registerHref}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-fill"
        onClick={() => void trackFunnelEvent("marketing_cta_register")}
      >
        注册领体验额度
      </Link>
    </div>
  );
}
