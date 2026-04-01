"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../lib/auth";
import { BillingToggle } from "../../../components/subscription/BillingToggle";
import { FaqAccordion } from "../../../components/subscription/FaqAccordion";
import { PricingHero } from "../../../components/subscription/PricingHero";
import { PricingPlanCard } from "../../../components/subscription/PricingPlanCard";
import { WalletUsageReference } from "../../../components/subscription/WalletUsageReference";
import type { PricingPlan, WalletTopupPayload } from "../../../components/subscription/types";
import { TrustFooter } from "../../../components/subscription/TrustFooter";

type PlansPayload = {
  success?: boolean;
  plans?: PricingPlan[];
  wallet_topup?: WalletTopupPayload;
  yearly_discount_percent?: number;
};

type MePayload = {
  success?: boolean;
  plan?: string;
  billing_cycle?: string | null;
  phone?: string;
  wallet_balance_cents?: number;
};

type CheckoutCreate = {
  success?: boolean;
  checkout_id?: string;
  amount_cents?: number;
  tier?: string;
  billing_cycle?: string;
  currency?: string;
  message?: string;
  detail?: string;
  error?: string;
};

type WalletCheckoutState = {
  checkout_id: string;
  amount_cents: number;
};

const FALLBACK_PLANS: PricingPlan[] = [
  { id: "free", name: "Free", monthly_price_cents: 0, yearly_price_cents: 0, description: "入门体验" },
  { id: "basic", name: "Basic", monthly_price_cents: 990, yearly_price_cents: 97900, description: "轻量订阅" },
  { id: "pro", name: "Pro", monthly_price_cents: 7900, yearly_price_cents: 77700, description: "专业创作" },
  { id: "max", name: "Creator（Max）", monthly_price_cents: 19900, yearly_price_cents: 195800, description: "高阶能力" }
];

function fmtYuan(cents?: number | null) {
  if (cents == null || typeof cents !== "number") return "—";
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function AdminSubscriptionPayPage() {
  const { getAuthHeaders, refreshMe } = useAuth();
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [yearlyDisc, setYearlyDisc] = useState<number | undefined>(undefined);
  const [walletTopupInfo, setWalletTopupInfo] = useState<PlansPayload["wallet_topup"]>(undefined);
  const [me, setMe] = useState<MePayload | null>(null);
  const [checkout, setCheckout] = useState<CheckoutCreate | null>(null);
  const [msg, setMsg] = useState("");
  const [creatingTier, setCreatingTier] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [freeSubmitting, setFreeSubmitting] = useState(false);
  const [topupYuanInput, setTopupYuanInput] = useState("10");
  const [walletCheckout, setWalletCheckout] = useState<WalletCheckoutState | null>(null);
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletPaying, setWalletPaying] = useState(false);

  const loadPlans = useCallback(async () => {
    try {
      const pr = await fetch("/api/subscription/plans", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const pd = (await pr.json().catch(() => ({}))) as PlansPayload;
      if (pd.success && Array.isArray(pd.plans)) setPlans(pd.plans);
      if (typeof pd.yearly_discount_percent === "number") setYearlyDisc(pd.yearly_discount_percent);
      if (pd.wallet_topup && typeof pd.wallet_topup === "object") setWalletTopupInfo(pd.wallet_topup);
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  const loadMe = useCallback(async () => {
    try {
      const mr = await fetch("/api/subscription/me", { headers: getAuthHeaders(), cache: "no-store" });
      const md = (await mr.json().catch(() => ({}))) as MePayload;
      if (mr.ok && md.success) setMe(md);
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void loadPlans();
    void loadMe();
  }, [loadPlans, loadMe]);

  const shownPlans = useMemo(() => {
    const list = plans.filter((p) => ["free", "basic", "pro", "max"].includes(p.id));
    return list.length ? list : FALLBACK_PLANS;
  }, [plans]);

  const anyBusy = creatingTier != null || paying || freeSubmitting || walletCreating || walletPaying;

  async function onSelectFree() {
    setFreeSubmitting(true);
    setMsg("");
    try {
      const res = await fetch("/api/subscription/select", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier: "free", billing_cycle: null })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string; error?: string };
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || `请求失败 ${res.status}`);
      setMsg("已切换为 Free");
      await loadMe();
      await refreshMe();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setFreeSubmitting(false);
    }
  }

  async function onCreateOrder(tier: string) {
    setCreatingTier(tier);
    setMsg("");
    setCheckout(null);
    try {
      const res = await fetch("/api/admin/subscription-checkout/create", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier, billing_cycle: cycle })
      });
      const data = (await res.json().catch(() => ({}))) as CheckoutCreate;
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `创建订单失败 ${res.status}`);
      }
      setCheckout(data);
      setMsg(data.message || "已创建收银会话，请确认支付");
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setCreatingTier(null);
    }
  }

  async function onConfirmPay() {
    if (!checkout?.checkout_id || !checkout.tier || !checkout.billing_cycle) return;
    setPaying(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/subscription-checkout/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          checkout_id: checkout.checkout_id,
          tier: checkout.tier,
          billing_cycle: checkout.billing_cycle
        })
      });
      const data = (await res.json().catch(() => ({}))) as CheckoutCreate;
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `支付确认失败 ${res.status}`);
      }
      setMsg("支付已入账，套餐已更新");
      setCheckout(null);
      await loadMe();
      await refreshMe();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setPaying(false);
    }
  }

  function parseTopupAmountCents(): { ok: true; cents: number } | { ok: false; error: string } {
    const minC = typeof walletTopupInfo?.min_amount_cents === "number" ? walletTopupInfo.min_amount_cents : 1000;
    const maxC = typeof walletTopupInfo?.max_amount_cents === "number" ? walletTopupInfo.max_amount_cents : 10_000_000;
    const y = Number(String(topupYuanInput || "").replace(/,/g, "").trim());
    if (!Number.isFinite(y) || y <= 0) return { ok: false, error: "请输入有效的充值金额（元）" };
    const cents = Math.round(y * 100);
    if (cents < minC) return { ok: false, error: `单次充值最低 ${(minC / 100).toFixed(2)} 元` };
    if (cents > maxC) return { ok: false, error: `单次充值最高 ${(maxC / 100).toFixed(2)} 元` };
    return { ok: true, cents };
  }

  async function onCreateWalletTopup() {
    const parsed = parseTopupAmountCents();
    if (!parsed.ok) {
      setMsg(parsed.error);
      return;
    }
    setWalletCreating(true);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/admin/wallet-checkout/create", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ amount_cents: parsed.cents })
      });
      const data = (await res.json().catch(() => ({}))) as CheckoutCreate;
      if (!res.ok || !data.success || !data.checkout_id) {
        throw new Error(data.detail || data.error || `创建充值单失败 ${res.status}`);
      }
      setWalletCheckout({
        checkout_id: data.checkout_id,
        amount_cents: Number(data.amount_cents ?? parsed.cents)
      });
      setMsg(data.message || "已创建钱包充值会话");
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setWalletCreating(false);
    }
  }

  async function onConfirmWalletTopup() {
    if (!walletCheckout) return;
    setWalletPaying(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/wallet-checkout/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ checkout_id: walletCheckout.checkout_id })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `钱包支付确认失败 ${res.status}`);
      }
      setMsg("余额已入账");
      setWalletCheckout(null);
      await loadMe();
      await refreshMe();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setWalletPaying(false);
    }
  }

  const supportEmail = typeof process.env.NEXT_PUBLIC_SUPPORT_EMAIL === "string" ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL : undefined;

  return (
    <main className="min-h-0 max-w-6xl">
      <PricingHero
        title="订阅收银（管理员内测）"
        subtitle="与公开订阅页同版式；模拟支付仅写入本环境订单与套餐，无真实三方跳转。"
      />

      <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted">
        本页<strong className="text-ink">不对外开放</strong>。生产可接三方收银台并关闭{" "}
        <code className="rounded bg-fill px-1 font-mono text-xs">ADMIN_SIMULATED_CHECKOUT_ENABLED</code>。
      </p>
      <p className="mt-2 text-center text-sm">
        <Link href="/admin/subscription-matrix" className="text-brand hover:underline">
          查看订阅与权限矩阵
        </Link>
      </p>

      <section className="mx-auto mt-8 max-w-2xl rounded-xl border border-line bg-surface/50 p-4">
        <h2 className="text-sm font-semibold text-ink">当前账号</h2>
        <p className="mt-2 text-sm text-muted">
          套餐：<span className="font-mono text-ink">{me?.plan ?? "—"}</span>
          {me?.billing_cycle ? (
            <span className="ml-3">
              周期：<span className="font-mono text-ink">{me.billing_cycle}</span>
            </span>
          ) : null}
        </p>
        {typeof me?.wallet_balance_cents === "number" ? (
          <p className="mt-2 text-sm text-muted">
            账户余额：<span className="font-mono text-ink">{fmtYuan(me.wallet_balance_cents)}</span>
          </p>
        ) : null}
        <button
          type="button"
          className="mt-3 rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs text-ink hover:bg-fill"
          onClick={() => void loadMe()}
        >
          刷新状态
        </button>
      </section>

      <div className="mt-10 space-y-8">
        <BillingToggle cycle={cycle} onChange={setCycle} yearlyDiscountPercent={yearlyDisc} />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {shownPlans.map((p) => (
            <PricingPlanCard
              key={p.id}
              plan={p}
              cycle={cycle}
              currentPlanId={me?.plan ?? "free"}
              submittingTier={null}
              primaryAction="custom"
              customButton={
                p.id === "free" ? (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-line bg-fill px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-canvas disabled:opacity-50"
                    disabled={anyBusy}
                    onClick={() => void onSelectFree()}
                  >
                    {freeSubmitting ? "处理中…" : "选用 Free"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded-xl bg-cta px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cta/90 disabled:opacity-50"
                    disabled={anyBusy}
                    onClick={() => void onCreateOrder(p.id)}
                  >
                    {creatingTier === p.id ? "创建订单中…" : "订阅并去支付"}
                  </button>
                )
              }
            />
          ))}
        </div>
      </div>

      {checkout?.checkout_id ? (
        <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <h2 className="text-sm font-semibold text-ink">待支付订单</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted">订单号</dt>
              <dd className="font-mono text-xs text-ink">{checkout.checkout_id}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted">应付</dt>
              <dd className="font-semibold text-ink">{fmtYuan(checkout.amount_cents)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={paying}
            onClick={() => void onConfirmPay()}
          >
            {paying ? "处理中…" : "确认支付（模拟成功）"}
          </button>
        </section>
      ) : null}

      {walletTopupInfo?.checkout_supported !== false && walletTopupInfo ? (
        <section className="mt-12 rounded-xl border border-dashed border-line bg-fill/30 p-5">
          <h2 className="text-sm font-semibold text-ink">账户余额充值</h2>
          <p className="mt-1 text-xs text-muted">
            {walletTopupInfo.description || "与公开页一致：入账钱包余额，单次最低 ¥10；不改变订阅档位。"}
          </p>
          <WalletUsageReference refData={walletTopupInfo.usage_reference} />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">充值金额（元）</span>
              <input
                type="number"
                min={(walletTopupInfo.min_amount_cents ?? 1000) / 100}
                step="1"
                className="w-full max-w-[12rem] rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-ink"
                value={topupYuanInput}
                onChange={(e) => setTopupYuanInput(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-cta px-4 py-2 text-sm font-medium text-white hover:bg-cta/90 disabled:opacity-50"
              disabled={anyBusy}
              onClick={() => void onCreateWalletTopup()}
            >
              {walletCreating ? "创建中…" : "去支付"}
            </button>
          </div>
          {walletCheckout ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="text-xs text-muted">
                待支付 <span className="font-mono text-ink">{walletCheckout.checkout_id}</span> · {fmtYuan(walletCheckout.amount_cents)}
              </p>
              <button
                type="button"
                className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                disabled={walletPaying}
                onClick={() => void onConfirmWalletTopup()}
              >
                {walletPaying ? "处理中…" : "确认支付（模拟成功）"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <FaqAccordion />
      <TrustFooter supportEmail={supportEmail} />

      {msg ? (
        <p
          className={`mt-6 text-center text-sm ${msg.includes("失败") || msg.includes("403") || msg.includes("400") ? "text-rose-600" : "text-muted"}`}
        >
          {msg}
        </p>
      ) : null}
    </main>
  );
}
