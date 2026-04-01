"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth";

type Usage = {
  period_days?: number;
  jobs_terminal?: number;
  quota?: number;
  percent?: number;
};

type OrderRow = {
  event_id?: string;
  status?: string;
  tier?: string;
  billing_cycle?: string | null;
  amount_cents?: number;
  provider?: string;
  created_at?: number;
};

function fmtMoneyYuan(cents?: number | null) {
  if (cents == null || typeof cents !== "number") return "—";
  return `¥${(cents / 100).toFixed(2)}`;
}

function fmtOrderTime(ts?: number) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return "—";
  }
}

export default function MeSubscriptionPage() {
  const { ready, authRequired, user, getAuthHeaders } = useAuth();
  const [currentPlan, setCurrentPlan] = useState<string>("—");
  const [billingCycle, setBillingCycle] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");

  const loadMe = useCallback(async () => {
    setLoadError("");
    try {
      const mr = await fetch("/api/subscription/me", { headers: getAuthHeaders(), cache: "no-store" });
      const md = (await mr.json().catch(() => ({}))) as {
        success?: boolean;
        plan?: string;
        billing_cycle?: string | null;
        usage?: Usage | null;
        orders?: OrderRow[];
        wallet_balance_cents?: number;
      };
      if (mr.ok && md.success) {
        setCurrentPlan(md.plan || "—");
        setBillingCycle(md.billing_cycle ?? null);
        setUsage(md.usage ?? null);
        setOrders(Array.isArray(md.orders) ? md.orders : []);
        if (typeof md.wallet_balance_cents === "number") setWalletBalanceCents(md.wallet_balance_cents);
        else setWalletBalanceCents(null);
      } else if (!mr.ok) {
        setLoadError(`加载失败（${mr.status}）`);
      }
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!ready || !authRequired || !user?.phone || user.phone === "local") return;
    void loadMe();
  }, [ready, authRequired, user?.phone, user?.plan, user?.billing_cycle, loadMe]);

  if (!ready) {
    return <p className="py-12 text-center text-sm text-muted">正在加载…</p>;
  }

  if (!authRequired || user?.phone === "local") {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card-sm">
        <p className="text-sm text-muted">当前为本地体验模式，无订阅与余额数据。登录账号后可查看套餐与钱包余额。</p>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card-sm">
        <p className="text-sm text-muted">请先登录后查看订阅信息。</p>
      </section>
    );
  }

  const recentOrders = orders.slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card-sm">
        <h2 className="text-sm font-semibold text-ink">订阅与余额概览</h2>
        <p className="mt-1 text-xs text-muted">当前会员档位、用量与账户余额（钱包）。升级套餐或充值请前往会员页。</p>
        {loadError ? <p className="mt-2 text-xs text-rose-600">{loadError}</p> : null}

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <dt className="text-muted">当前方案</dt>
            <dd className="font-mono text-ink">{currentPlan}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <dt className="text-muted">付费周期</dt>
            <dd className="text-ink">{billingCycle || "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <dt className="text-muted">账户余额</dt>
            <dd className="font-mono text-ink">{fmtMoneyYuan(walletBalanceCents)}</dd>
          </div>
        </dl>

        {usage ? (
          <div className="mt-4 rounded-xl border border-line bg-fill/40 px-3 py-3">
            <p className="text-xs font-medium text-ink">用量（参考）</p>
            <p className="mt-2 text-sm text-muted">
              近 {usage.period_days ?? 30} 天内，已完成创作次数：{" "}
              <span className="font-mono text-ink">
                {usage.jobs_terminal ?? 0} / {usage.quota ?? "—"}
              </span>
              {typeof usage.percent === "number" ? <span className="text-muted">（约 {usage.percent}%）</span> : null}
            </p>
            <p className="mt-1 text-[11px] text-muted">次数与会员档位相关说明以会员页为准。</p>
          </div>
        ) : null}

        <div className="mt-4">
          <Link
            href="/subscription"
            className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95"
          >
            前往会员与套餐
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card-sm">
        <h2 className="text-sm font-semibold text-ink">最近订单</h2>
        <p className="mt-1 text-xs text-muted">最近 5 条；完整记录请在会员页查看。</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-fill/30">
          <table className="min-w-[560px] w-full text-left text-sm text-ink">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">方案</th>
                <th className="px-3 py-2">金额</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted">
                    暂无订单记录
                  </td>
                </tr>
              ) : (
                recentOrders.map((o, idx) => (
                  <tr key={o.event_id ? String(o.event_id) : `ord_${idx}`} className="border-t border-line/80">
                    <td className="px-3 py-2 text-xs text-muted">{fmtOrderTime(o.created_at)}</td>
                    <td className="px-3 py-2">{o.status || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.tier || "—"}</td>
                    <td className="px-3 py-2">{fmtMoneyYuan(o.amount_cents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
