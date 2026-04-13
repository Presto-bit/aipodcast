"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { FaqAccordion } from "../../components/subscription/FaqAccordion";
import { FALLBACK_SUBSCRIPTION_PLANS } from "../../components/subscription/fallbackPlans";
import { PricingHero } from "../../components/subscription/PricingHero";
import { PricingPlansGrid } from "../../components/subscription/PricingPlansGrid";
import { WalletUsageReference } from "../../components/subscription/WalletUsageReference";
import type { PricingPlan, WalletTopupPayload } from "../../components/subscription/types";
import { TrustFooter } from "../../components/subscription/TrustFooter";

type OrderRow = {
  event_id?: string;
  status?: string;
  tier?: string;
  billing_cycle?: string | null;
  amount_cents?: number;
  provider?: string;
  created_at?: number;
};

type PlansPayload = {
  success?: boolean;
  plans?: PricingPlan[];
  addons?: unknown[];
  wallet_topup?: WalletTopupPayload;
  billing_monthly_only?: boolean;
  yearly_discount_percent?: number;
  payment_channels?: {
    alipay_page?: { enabled?: boolean; label_zh?: string };
  };
};

type WalletCheckoutState = {
  checkout_id: string;
  amount_cents: number;
};

type UsageSnapshot = {
  period_days: number;
  monthly_audio_minutes_cap: number;
  monthly_audio_minutes_used: number;
  monthly_text_polish_used: number;
  monthly_text_polish_cap: number | null;
};

export default function SubscriptionPage() {
  const { getAuthHeaders, refreshMe, user } = useAuth();
  const [cycle] = useState<"monthly" | "yearly">("monthly");
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [yearlyDisc, setYearlyDisc] = useState<number | undefined>(undefined);
  const [billingMonthlyOnly, setBillingMonthlyOnly] = useState(true);
  const [walletTopupInfo, setWalletTopupInfo] = useState<PlansPayload["wallet_topup"]>(undefined);
  const [currentPlan, setCurrentPlan] = useState("free");
  const [billingCycle, setBillingCycle] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [checkoutIntent, setCheckoutIntent] = useState<{ tier: string; billing_cycle: string } | null>(null);
  const [topupYuanInput, setTopupYuanInput] = useState("10");
  const [msg, setMsg] = useState("");
  const [submittingTier, setSubmittingTier] = useState<string | null>(null);
  const [walletCheckout, setWalletCheckout] = useState<WalletCheckoutState | null>(null);
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletPaying, setWalletPaying] = useState(false);
  const [alipayPageEnabled, setAlipayPageEnabled] = useState(false);
  const [alipayLoadingTier, setAlipayLoadingTier] = useState<string | null>(null);
  const [alipayWalletLoading, setAlipayWalletLoading] = useState(false);
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);
  const [walletPayBusyTier, setWalletPayBusyTier] = useState<string | null>(null);

  const mergedWalletTopup = useMemo((): WalletTopupPayload => {
    const base: WalletTopupPayload = {
      enabled: true,
      checkout_supported: true,
      min_amount_cents: 1000,
      max_amount_cents: 10_000_000,
      description:
        "充值进入账户余额（人民币），按实际使用扣减；单次充值最低 ¥10，不设过期；不改变当前订阅档位。",
      usage_reference: {
        podcast_yuan_per_minute: 0.25,
        voice_clone_payg_cents: 1290,
        disclaimer_zh: "余额实际扣减以任务完成时执行为准。"
      }
    };
    if (!walletTopupInfo || typeof walletTopupInfo !== "object") return base;
    const urIn = walletTopupInfo.usage_reference;
    return {
      ...base,
      ...walletTopupInfo,
      usage_reference: {
        ...base.usage_reference,
        ...(urIn && typeof urIn === "object" ? urIn : {})
      }
    };
  }, [walletTopupInfo]);

  const showWalletRechargeSection =
    mergedWalletTopup.enabled !== false &&
    (alipayPageEnabled || mergedWalletTopup.checkout_supported !== false);

  const loadPlans = useCallback(async () => {
    try {
      const pr = await fetch("/api/subscription/plans", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const pd = (await pr.json().catch(() => ({}))) as PlansPayload;
      if (pd.success && Array.isArray(pd.plans)) setPlans(pd.plans);
      setBillingMonthlyOnly(pd.billing_monthly_only !== false);
      if (typeof pd.yearly_discount_percent === "number") setYearlyDisc(pd.yearly_discount_percent);
      if (pd.wallet_topup && typeof pd.wallet_topup === "object") setWalletTopupInfo(pd.wallet_topup);
      setAlipayPageEnabled(pd.payment_channels?.alipay_page?.enabled === true);
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  const loadMe = useCallback(async () => {
    try {
      const mr = await fetch("/api/subscription/me", { headers: getAuthHeaders(), cache: "no-store" });
      const md = (await mr.json().catch(() => ({}))) as {
        success?: boolean;
        plan?: string;
        billing_cycle?: string | null;
        orders?: OrderRow[];
        wallet_balance_cents?: number;
        subscription_checkout_intent?: { tier?: string; billing_cycle?: string } | null;
        usage?: {
          period_days?: number;
          monthly_audio_minutes_cap?: number;
          monthly_audio_minutes_used?: number;
          monthly_text_polish_used?: number;
          monthly_text_polish_cap?: number | null;
        };
      };
      if (mr.ok && md.success) {
        setCurrentPlan(md.plan?.trim() ? md.plan : "free");
        setBillingCycle(md.billing_cycle ?? null);
        setOrders(Array.isArray(md.orders) ? md.orders : []);
        if (typeof md.wallet_balance_cents === "number") setWalletBalanceCents(md.wallet_balance_cents);
        else setWalletBalanceCents(null);
        const u = md.usage;
        if (u && typeof u === "object") {
          setUsageSnapshot({
            period_days: typeof u.period_days === "number" ? u.period_days : 30,
            monthly_audio_minutes_cap:
              typeof u.monthly_audio_minutes_cap === "number" ? u.monthly_audio_minutes_cap : 0,
            monthly_audio_minutes_used:
              typeof u.monthly_audio_minutes_used === "number" ? u.monthly_audio_minutes_used : 0,
            monthly_text_polish_used:
              typeof u.monthly_text_polish_used === "number" ? u.monthly_text_polish_used : 0,
            monthly_text_polish_cap:
              u.monthly_text_polish_cap === null || typeof u.monthly_text_polish_cap === "number"
                ? u.monthly_text_polish_cap
                : null
          });
        } else {
          setUsageSnapshot(null);
        }
        const ci = md.subscription_checkout_intent;
        if (ci && typeof ci.tier === "string" && ci.tier.trim() && typeof ci.billing_cycle === "string") {
          setCheckoutIntent({ tier: ci.tier.trim(), billing_cycle: ci.billing_cycle.trim() });
        } else {
          setCheckoutIntent(null);
        }
      } else {
        setUsageSnapshot(null);
      }
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void loadPlans();
    void loadMe();
  }, [loadPlans, loadMe]);

  /** 支付宝同步回跳（GET）常带 out_trade_no / trade_no；刷新订单并清理地址栏避免重复提示。 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (!q.get("out_trade_no") && !q.get("trade_no")) return;
    void loadMe();
    void refreshMe();
    setMsg("支付已完成或处理中，正在同步订单…");
    window.history.replaceState({}, "", window.location.pathname);
  }, [loadMe, refreshMe]);

  const shownPlans = useMemo(() => (plans.length ? plans : FALLBACK_SUBSCRIPTION_PLANS), [plans]);

  const walletPayEnabled = Boolean(user && typeof user.phone === "string" && user.phone !== "" && user.phone !== "local");

  const busyPayOrWallet =
    (submittingTier != null && submittingTier !== "") ||
    (alipayLoadingTier != null && alipayLoadingTier !== "") ||
    (walletPayBusyTier != null && walletPayBusyTier !== "");

  function fmtOrderTime(ts?: number) {
    if (!ts) return "—";
    try {
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return "—";
    }
  }

  function fmtMoneyYuan(cents?: number | null) {
    if (cents == null || typeof cents !== "number") return "—";
    return `¥${(cents / 100).toFixed(2)}`;
  }

  async function payWithWalletForTier(tier: string) {
    if (tier === "free") return;
    setWalletPayBusyTier(tier);
    setMsg("");
    try {
      const res = await fetch("/api/subscription/pay-with-wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier, billing_cycle: "monthly" })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        detail?: unknown;
        error?: string;
        message?: string;
        wallet_balance_cents?: number;
      };
      if (!res.ok || !data.success) {
        const d = data.detail;
        const detailStr =
          typeof d === "string"
            ? d
            : typeof data.error === "string"
              ? data.error
              : Array.isArray(d)
                ? String(d[0] || "")
                : `请求失败 ${res.status}`;
        throw new Error(detailStr || `请求失败 ${res.status}`);
      }
      setMsg(data.message || "已使用账户余额支付并开通订阅");
      if (typeof data.wallet_balance_cents === "number") setWalletBalanceCents(data.wallet_balance_cents);
      await loadMe();
      await refreshMe();
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setWalletPayBusyTier(null);
    }
  }

  async function selectPlan(tier: string) {
    setSubmittingTier(tier);
    setMsg("");
    try {
      const res = await fetch("/api/subscription/select", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier, billing_cycle: tier === "free" ? null : "monthly" })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        detail?: string;
        message?: string;
        user?: { plan?: string };
      };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `请求失败 ${res.status}`);
      setCurrentPlan(data.user?.plan || tier);
      setMsg(data.message || "已保存");
      await loadMe();
      await refreshMe();
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmittingTier(null);
    }
  }

  async function createAlipaySubscription(tier: string) {
    if (tier === "free") return;
    setAlipayLoadingTier(tier);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/alipay-page/subscription", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier, billing_cycle: "monthly" })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        pay_page_url?: string;
        out_trade_no?: string;
        amount_cents?: number;
        detail?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success || !data.pay_page_url || !data.out_trade_no) {
        throw new Error(data.detail || data.error || `支付宝下单失败 ${res.status}`);
      }
      /** 当前页跳转支付宝网关，避免先开空白窗再赋值被浏览器拦截 */
      window.location.assign(data.pay_page_url);
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setAlipayLoadingTier(null);
    }
  }

  function parseTopupAmountCents(): { ok: true; cents: number } | { ok: false; error: string } {
    const minC =
      typeof mergedWalletTopup.min_amount_cents === "number" ? mergedWalletTopup.min_amount_cents : 1000;
    const maxC =
      typeof mergedWalletTopup.max_amount_cents === "number" ? mergedWalletTopup.max_amount_cents : 10_000_000;
    const y = Number(String(topupYuanInput || "").replace(/,/g, "").trim());
    if (!Number.isFinite(y) || y <= 0) return { ok: false, error: "请输入有效的充值金额（元）" };
    const cents = Math.round(y * 100);
    if (cents < minC) return { ok: false, error: `单次充值最低 ${(minC / 100).toFixed(2)} 元` };
    if (cents > maxC) return { ok: false, error: `单次充值最高 ${(maxC / 100).toFixed(2)} 元` };
    return { ok: true, cents };
  }

  async function createWalletOrder() {
    const parsed = parseTopupAmountCents();
    if (!parsed.ok) {
      setMsg(parsed.error);
      return;
    }
    setWalletCreating(true);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/wallet-checkout/create", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ amount_cents: parsed.cents })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        checkout_id?: string;
        amount_cents?: number;
        detail?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success || !data.checkout_id) {
        throw new Error(data.detail || data.error || `创建失败 ${res.status}`);
      }
      setWalletCheckout({
        checkout_id: data.checkout_id,
        amount_cents: Number(data.amount_cents ?? parsed.cents)
      });
      setMsg(data.message || "已创建收银会话，请确认支付");
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setWalletCreating(false);
    }
  }

  async function confirmWalletOrder() {
    if (!walletCheckout) return;
    setWalletPaying(true);
    setMsg("");
    try {
      const res = await fetch("/api/subscription/wallet-checkout/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ checkout_id: walletCheckout.checkout_id })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        wallet_balance_cents?: number;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `支付确认失败 ${res.status}`);
      }
      setMsg("余额已入账（订阅档位不变；实际业务扣款需在任务侧调用扣减接口）");
      setWalletCheckout(null);
      if (typeof data.wallet_balance_cents === "number") setWalletBalanceCents(data.wallet_balance_cents);
      await loadMe();
      await refreshMe();
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setWalletPaying(false);
    }
  }

  async function createAlipayWalletTopup() {
    const parsed = parseTopupAmountCents();
    if (!parsed.ok) {
      setMsg(parsed.error);
      return;
    }
    setAlipayWalletLoading(true);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/alipay-page/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ amount_cents: parsed.cents })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        pay_page_url?: string;
        out_trade_no?: string;
        amount_cents?: number;
        detail?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success || !data.pay_page_url || !data.out_trade_no) {
        throw new Error(data.detail || data.error || `支付宝充值下单失败 ${res.status}`);
      }
      window.location.assign(data.pay_page_url);
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setAlipayWalletLoading(false);
    }
  }

  const supportEmail = typeof process.env.NEXT_PUBLIC_SUPPORT_EMAIL === "string" ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL : undefined;

  return (
    <main className="min-h-0 max-w-6xl">
      <PricingHero />

      <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted">
        各档位权益说明见下方卡片；<strong className="text-ink">支付成功或余额扣款成功后</strong>
        ，会员权益会自动更新。超额创作可充值账户余额按量扣费（与月配额并行）。
      </p>

      {checkoutIntent ? (
        <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-center text-sm text-ink">
          已选开通意向：<span className="font-mono font-medium">{checkoutIntent.tier}</span> ·{" "}
          <span className="font-mono">{checkoutIntent.billing_cycle}</span>
          <span className="block text-xs text-muted">须完成支付后才会生效；Free 档无需支付。</span>
        </div>
      ) : null}

      {walletPayEnabled && (usageSnapshot != null || walletBalanceCents != null) ? (
        <section className="mx-auto mt-8 max-w-2xl rounded-xl border border-line bg-surface/50 p-4">
          <h2 className="text-sm font-semibold text-ink">账户与用量</h2>
          {usageSnapshot ? (
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p>
                近 {usageSnapshot.period_days} 天音频生成：{" "}
                <span className="font-mono text-ink">
                  {usageSnapshot.monthly_audio_minutes_used} / {usageSnapshot.monthly_audio_minutes_cap} 分钟
                </span>
              </p>
              <p>
                AI 润色（TTS 前）：{" "}
                <span className="font-mono text-ink">
                  {usageSnapshot.monthly_text_polish_used} /{" "}
                  {usageSnapshot.monthly_text_polish_cap == null
                    ? "不限"
                    : usageSnapshot.monthly_text_polish_cap}
                </span>
              </p>
            </div>
          ) : null}
          {typeof walletBalanceCents === "number" ? (
            <p className={`text-sm text-muted ${usageSnapshot ? "mt-2" : "mt-3"}`}>
              账户余额（用于超额按量计费或余额支付月费）：{" "}
              <span className="font-mono text-ink">{fmtMoneyYuan(walletBalanceCents)}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      <PricingPlansGrid
        plans={shownPlans}
        cycle={cycle}
        onCycleChange={() => {}}
        hideBillingCycleToggle={billingMonthlyOnly}
        yearlyDiscountPercent={yearlyDisc}
        currentPlanId={currentPlan}
        submittingTier={submittingTier}
        onSelectPlan={(tier) => void selectPlan(tier)}
        alipayPageEnabled={alipayPageEnabled}
        alipayLoadingTier={alipayLoadingTier}
        onAlipayPay={(tier) => void createAlipaySubscription(tier)}
        walletPayEnabled={walletPayEnabled}
        walletPayBusyTier={walletPayBusyTier}
        onWalletPay={(tier) => void payWithWalletForTier(tier)}
      />

      {showWalletRechargeSection ? (
        <section className="mt-12 rounded-xl border border-dashed border-line bg-fill/30 p-5">
          <h2 className="text-sm font-semibold text-ink">账户余额充值</h2>
          <p className="mt-1 text-xs text-muted">
            {mergedWalletTopup.description ||
              "充值进入钱包（单位：人民币），用多少扣多少；单次最低 ¥10；不改变订阅档位。"}
          </p>
          <WalletUsageReference refData={mergedWalletTopup.usage_reference} />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">充值金额（元）</span>
              <input
                type="number"
                min={(mergedWalletTopup.min_amount_cents ?? 1000) / 100}
                step="1"
                className="w-full max-w-[12rem] rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-ink"
                value={topupYuanInput}
                onChange={(e) => setTopupYuanInput(e.target.value)}
              />
            </label>
            {mergedWalletTopup.checkout_supported !== false ? (
              <button
                type="button"
                className="rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:bg-cta/90 disabled:opacity-50"
                disabled={
                  walletCreating || walletPaying || alipayWalletLoading || busyPayOrWallet || !walletPayEnabled
                }
                onClick={() => void createWalletOrder()}
              >
                {walletCreating ? "创建订单中…" : "去支付（内测模拟）"}
              </button>
            ) : null}
            {alipayPageEnabled ? (
              <button
                type="button"
                className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  mergedWalletTopup.checkout_supported === false
                    ? "bg-cta text-cta-foreground hover:bg-cta/90"
                    : "border border-line bg-canvas text-ink hover:bg-fill"
                }`}
                disabled={
                  walletCreating || walletPaying || alipayWalletLoading || busyPayOrWallet || !walletPayEnabled
                }
                onClick={() => void createAlipayWalletTopup()}
              >
                {alipayWalletLoading ? "正在跳转支付宝…" : "支付宝扫码充值"}
              </button>
            ) : null}
          </div>
          {!walletPayEnabled ? (
            <p className="mt-3 text-xs text-muted">请登录后即可充值账户余额。</p>
          ) : null}
          {walletCheckout ? (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft/80 p-3 dark:border-warning/40 dark:bg-warning-soft/35">
              <p className="text-xs text-muted">
                待支付 <span className="font-mono text-ink">{walletCheckout.checkout_id}</span> ·{" "}
                {fmtMoneyYuan(walletCheckout.amount_cents)}
              </p>
              <button
                type="button"
                className="mt-2 rounded-lg bg-mint px-3 py-1.5 text-xs font-medium text-mint-foreground hover:bg-mint/85 disabled:opacity-50"
                disabled={walletPaying}
                onClick={() => void confirmWalletOrder()}
              >
                {walletPaying ? "处理中…" : "确认支付（模拟成功）"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <FaqAccordion />
      <TrustFooter supportEmail={supportEmail} />

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-lg font-semibold text-ink">订单记录</h2>
        <p className="mt-1 text-xs text-muted">
          当前方案：<span className="text-ink">{currentPlan}</span>
          {billingCycle ? (
            <span className="ml-2">
              付费周期：<span className="text-ink">{billingCycle}</span>
            </span>
          ) : null}
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface/40">
          <table className="min-w-[720px] w-full text-left text-sm text-ink">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">方案</th>
                <th className="px-3 py-2">周期</th>
                <th className="px-3 py-2">金额</th>
                <th className="px-3 py-2">支付方式</th>
                <th className="px-3 py-2">参考编号</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">
                    暂无订单记录。完成支付后，相关条目会显示在这里。
                  </td>
                </tr>
              ) : (
                orders.map((o, idx) => (
                  <tr key={o.event_id ? String(o.event_id) : `ord_${idx}`} className="border-t border-line/80">
                    <td className="px-3 py-2 text-xs text-muted">{fmtOrderTime(o.created_at)}</td>
                    <td className="px-3 py-2">{o.status || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.tier || "—"}</td>
                    <td className="px-3 py-2 text-xs">{o.billing_cycle || "—"}</td>
                    <td className="px-3 py-2">{fmtMoneyYuan(o.amount_cents)}</td>
                    <td className="px-3 py-2 text-xs">{o.provider || "—"}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-[10px]" title={o.event_id}>
                      {o.event_id || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {msg ? <p className="mt-4 text-center text-sm text-muted">{msg}</p> : null}
    </main>
  );
}
