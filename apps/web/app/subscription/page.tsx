"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { FaqAccordion } from "../../components/subscription/FaqAccordion";
import { FALLBACK_SUBSCRIPTION_PLANS } from "../../components/subscription/fallbackPlans";
import { PricingHero } from "../../components/subscription/PricingHero";
import { PricingPlansGrid } from "../../components/subscription/PricingPlansGrid";
import { WalletUsageReference } from "../../components/subscription/WalletUsageReference";
import type { PricingPlan, WalletTopupPayload } from "../../components/subscription/types";
import { TrustFooter } from "../../components/subscription/TrustFooter";
import { parseSubscriptionErrorBody } from "../../lib/subscriptionError";

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
  const [topupYuanInput, setTopupYuanInput] = useState("10");
  const [msg, setMsg] = useState("");
  const [submittingTier, setSubmittingTier] = useState<string | null>(null);
  const [walletCheckout, setWalletCheckout] = useState<WalletCheckoutState | null>(null);
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletPaying, setWalletPaying] = useState(false);
  const [alipayPageEnabled, setAlipayPageEnabled] = useState(false);
  const [alipayLoadingTier, setAlipayLoadingTier] = useState<string | null>(null);
  const [alipayWalletLoading, setAlipayWalletLoading] = useState(false);
  const [plansConfigLoaded, setPlansConfigLoaded] = useState(false);
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);

  /** 本地联调可选：NEXT_PUBLIC_ENABLE_MOCK_WALLET=1 才展示内测模拟充值；生产环境仅走支付宝。 */
  const allowMockWallet =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_MOCK_WALLET === "1";

  const mergedWalletTopup = useMemo((): WalletTopupPayload => {
    const base: WalletTopupPayload = {
      enabled: true,
      /** 编排器未返回前：允许内测模拟充值；若已接支付宝则由 plans 覆盖为 checkout_supported=false */
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

  /** 与编排器约定：未接支付宝时 checkout_supported=true 走内测模拟；接支付宝后仍展示「支付宝充值」入口 */
  const showWalletRechargeSection = plansConfigLoaded && mergedWalletTopup.enabled !== false;

  const loadPlans = useCallback(async () => {
    try {
      const pr = await fetch("/api/subscription/plans", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const pd = (await pr.json().catch(() => ({}))) as PlansPayload;
      if (pd.success) {
        if (Array.isArray(pd.plans)) setPlans(pd.plans);
        setBillingMonthlyOnly(pd.billing_monthly_only !== false);
        if (typeof pd.yearly_discount_percent === "number") setYearlyDisc(pd.yearly_discount_percent);
        setWalletTopupInfo(pd.wallet_topup && typeof pd.wallet_topup === "object" ? pd.wallet_topup : {});
        setAlipayPageEnabled(pd.payment_channels?.alipay_page?.enabled === true);
      }
    } catch {
      // ignore
    } finally {
      setPlansConfigLoaded(true);
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
      };
      if (mr.ok && md.success) {
        setCurrentPlan(md.plan?.trim() ? md.plan : "free");
        setBillingCycle(md.billing_cycle ?? null);
        setOrders(Array.isArray(md.orders) ? md.orders : []);
        if (typeof md.wallet_balance_cents === "number") setWalletBalanceCents(md.wallet_balance_cents);
        else setWalletBalanceCents(null);
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

  /** 邮箱注册用户无 `phone` 字段时也应可发起支付宝/余额支付（与编排器会话一致） */
  const walletPayEnabled = isLoggedInAccountUser(user);

  const busyPayOrWallet =
    (submittingTier != null && submittingTier !== "") || (alipayLoadingTier != null && alipayLoadingTier !== "");

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
    setMsg("正在连接支付宝…页面打开后请用手机支付宝扫码完成支付，支付成功后将自动升级档位。");
    setWalletCheckout(null);
    let didNavigate = false;
    const ac = new AbortController();
    const payTimer = window.setTimeout(() => ac.abort(), 60_000);
    try {
      const res = await fetch("/api/subscription/alipay-page/subscription", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier, billing_cycle: "monthly" }),
        credentials: "same-origin",
        signal: ac.signal
      });
      const text = await res.text();
      const data = (() => {
        try {
          return JSON.parse(text) as {
            success?: boolean;
            pay_page_url?: string;
            out_trade_no?: string;
            amount_cents?: number;
            detail?: string;
            error?: string;
            message?: string;
          };
        } catch {
          return {};
        }
      })();
      if (!res.ok || !data.success) {
        throw new Error(parseSubscriptionErrorBody(text, `支付宝下单失败 ${res.status}`));
      }
      const payUrl = typeof data.pay_page_url === "string" ? data.pay_page_url.trim() : "";
      if (!payUrl) {
        throw new Error("收银台未返回有效支付链接，请稍后重试或联系客服");
      }
      if (!data.out_trade_no) {
        throw new Error("订单号缺失，请重试");
      }
      didNavigate = true;
      window.location.assign(payUrl);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        setMsg("连接收银台超时，请检查网络或稍后重试。");
      } else {
        setMsg(String(err instanceof Error ? err.message : err));
      }
    } finally {
      clearTimeout(payTimer);
      if (!didNavigate) setAlipayLoadingTier(null);
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
    let didNavigateWallet = false;
    const wac = new AbortController();
    const wTimer = window.setTimeout(() => wac.abort(), 60_000);
    setAlipayWalletLoading(true);
    setMsg("正在连接支付宝…页面打开后请用手机扫码完成充值。");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/alipay-page/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ amount_cents: parsed.cents }),
        credentials: "same-origin",
        signal: wac.signal
      });
      const text = await res.text();
      const data = (() => {
        try {
          return JSON.parse(text) as {
            success?: boolean;
            pay_page_url?: string;
            out_trade_no?: string;
            amount_cents?: number;
          };
        } catch {
          return {};
        }
      })();
      if (!res.ok || !data.success) {
        throw new Error(parseSubscriptionErrorBody(text, `支付宝充值下单失败 ${res.status}`));
      }
      const payUrl = typeof data.pay_page_url === "string" ? data.pay_page_url.trim() : "";
      if (!payUrl) throw new Error("收银台未返回有效支付链接，请稍后重试或联系客服");
      if (!data.out_trade_no) throw new Error("订单号缺失，请重试");
      didNavigateWallet = true;
      window.location.assign(payUrl);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        setMsg("连接支付宝超时，请检查网络或稍后重试。");
      } else {
        setMsg(String(err instanceof Error ? err.message : err));
      }
    } finally {
      clearTimeout(wTimer);
      if (!didNavigateWallet) setAlipayWalletLoading(false);
    }
  }

  const supportEmail = typeof process.env.NEXT_PUBLIC_SUPPORT_EMAIL === "string" ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL : undefined;

  return (
    <main className="min-h-0 max-w-6xl">
      <PricingHero />

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
        onPaidTierWithoutAlipay={() =>
          setMsg("付费订阅需跳转支付宝完成付款后才会生效。请在服务器配置 ALIPAY_PAY_ENABLED、密钥与 ALIPAY_NOTIFY_URL，并确保异步通知可达。")
        }
      />

      {showWalletRechargeSection ? (
        <section className="mt-12 rounded-xl border border-dashed border-line bg-fill/30 p-5">
          <h2 className="text-sm font-semibold text-ink">账户余额充值</h2>
          {walletBalanceCents != null ? (
            <p className="mt-1 text-sm text-ink">
              当前余额：<span className="font-mono font-semibold">{fmtMoneyYuan(walletBalanceCents)}</span>
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {mergedWalletTopup.description ||
              "充值进入钱包（单位：人民币），用多少扣多少；单次最低 ¥10；不改变订阅档位。"}
          </p>
          {alipayPageEnabled ? (
            <p className="mt-2 text-xs text-muted">
              跳转支付宝页后请用手机扫码付款，成功后余额会自动更新。套餐内用量用尽后，按量任务会从余额扣费（以服务端记录为准）。
            </p>
          ) : null}
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
            {alipayPageEnabled ? (
              <button
                type="button"
                className="rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:bg-cta/90 disabled:opacity-50"
                disabled={
                  walletCreating || walletPaying || alipayWalletLoading || busyPayOrWallet || !walletPayEnabled
                }
                onClick={() => void createAlipayWalletTopup()}
              >
                {alipayWalletLoading ? "正在跳转支付宝…" : "充值"}
              </button>
            ) : allowMockWallet && mergedWalletTopup.checkout_supported !== false ? (
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
            ) : (
              <p className="text-xs text-muted">
                余额充值需开通支付宝：请在服务端配置 ALIPAY_* 并启用 <code className="rounded bg-fill px-1">payment_channels.alipay_page</code>
                。
              </p>
            )}
          </div>
          {!walletPayEnabled ? (
            <p className="mt-3 text-xs text-muted">请登录后即可充值账户余额。</p>
          ) : null}
          {walletCheckout && allowMockWallet ? (
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
