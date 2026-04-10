"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth, userAccountRef } from "../lib/auth";

const PLAN_LABEL: Record<string, string> = {
  free: "免费",
  basic: "入门",
  pro: "专业",
  max: "旗舰"
};

function labelForPlan(raw: string): string {
  const p = (raw || "free").trim().toLowerCase();
  return PLAN_LABEL[p] || raw || "免费";
}

export default function SidebarPlanStrip({ collapsed }: { collapsed: boolean }) {
  const { user, ready, authRequired, getAuthHeaders } = useAuth();
  const [walletCents, setWalletCents] = useState<number | null>(null);

  const loadWallet = useCallback(async () => {
    if (!ready || !authRequired) return;
    if (!userAccountRef(user)) return;
    try {
      const r = await fetch("/api/subscription/me", { headers: getAuthHeaders(), cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { success?: boolean; wallet_balance_cents?: number };
      if (r.ok && d.success && typeof d.wallet_balance_cents === "number") {
        setWalletCents(d.wallet_balance_cents);
      }
    } catch {
      // ignore
    }
  }, [ready, authRequired, user, getAuthHeaders]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  if (!ready || !authRequired || !user || user.phone === "local") return null;

  const planZh = labelForPlan(String(user.plan || "free"));
  const walletStr =
    walletCents != null && Number.isFinite(walletCents) ? `¥${(walletCents / 100).toFixed(2)}` : null;
  const title = walletStr ? `当前方案：${planZh} · 钱包 ${walletStr}` : `当前方案：${planZh}`;

  if (collapsed) {
    return (
      <div
        className="mx-1.5 flex justify-center border-t border-line/80 py-2"
        data-testid="sidebar-plan-strip"
      >
        <Link
          href="/me/subscription"
          title={title}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-semibold text-brand hover:bg-fill"
        >
          付
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-1.5 border-t border-line/80 px-2 py-2" data-testid="sidebar-plan-strip">
      <Link
        href="/me/subscription"
        className="flex flex-col gap-0.5 rounded-lg border border-line/90 bg-fill/50 px-2.5 py-2 text-[11px] leading-snug transition-colors hover:border-brand/35 hover:bg-fill"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="text-muted">方案</span>
          <span className="font-medium text-ink">{planZh}</span>
        </div>
        {walletStr ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-muted">钱包</span>
            <span className="tabular-nums text-ink">{walletStr}</span>
          </div>
        ) : null}
        <span className="text-[10px] text-brand">订阅与订单 →</span>
      </Link>
    </div>
  );
}
