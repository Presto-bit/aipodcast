"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "../../lib/auth";
import { FaqAccordion } from "../../components/subscription/FaqAccordion";
import { PricingHero } from "../../components/subscription/PricingHero";
import { PricingPlansGrid } from "../../components/subscription/PricingPlansGrid";
import { WalletUsageReference } from "../../components/subscription/WalletUsageReference";
import type { PricingPlan, WalletTopupPayload } from "../../components/subscription/types";
import { TrustFooter } from "../../components/subscription/TrustFooter";

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

type PlansPayload = {
  success?: boolean;
  plans?: PricingPlan[];
  addons?: unknown[];
  wallet_topup?: WalletTopupPayload;
  yearly_discount_percent?: number;
  payment_channels?: {
    wechat_native?: { enabled?: boolean; label_zh?: string };
  };
};

type WalletCheckoutState = {
  checkout_id: string;
  amount_cents: number;
};

type WechatPaySession =
  | {
      kind: "subscription";
      code_url: string;
      out_trade_no: string;
      amount_cents: number;
      tier: string;
    }
  | { kind: "wallet"; code_url: string; out_trade_no: string; amount_cents: number };

const FALLBACK_PLANS: PricingPlan[] = [
  { id: "free", name: "Free", monthly_price_cents: 0, yearly_price_cents: 0, description: "入门体验" },
  { id: "basic", name: "Basic", monthly_price_cents: 990, yearly_price_cents: 97900, description: "轻量订阅" },
  { id: "pro", name: "Pro", monthly_price_cents: 7900, yearly_price_cents: 77700, description: "专业创作" },
  { id: "max", name: "Creator（Max）", monthly_price_cents: 19900, yearly_price_cents: 195800, description: "高阶能力" }
];

export default function SubscriptionPage() {
  const { getAuthHeaders, refreshMe } = useAuth();
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [yearlyDisc, setYearlyDisc] = useState<number | undefined>(undefined);
  const [walletTopupInfo, setWalletTopupInfo] = useState<PlansPayload["wallet_topup"]>(undefined);
  const [currentPlan, setCurrentPlan] = useState("free");
  const [billingCycle, setBillingCycle] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [checkoutIntent, setCheckoutIntent] = useState<{ tier: string; billing_cycle: string } | null>(null);
  const [topupYuanInput, setTopupYuanInput] = useState("10");
  const [msg, setMsg] = useState("");
  const [submittingTier, setSubmittingTier] = useState<string | null>(null);
  const [walletCheckout, setWalletCheckout] = useState<WalletCheckoutState | null>(null);
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletPaying, setWalletPaying] = useState(false);
  const [wechatNativeEnabled, setWechatNativeEnabled] = useState(false);
  const [wechatLoadingTier, setWechatLoadingTier] = useState<string | null>(null);
  const [wechatWalletLoading, setWechatWalletLoading] = useState(false);
  const [wechatPay, setWechatPay] = useState<WechatPaySession | null>(null);
  const [wechatQrDataUrl, setWechatQrDataUrl] = useState("");

  const loadPlans = useCallback(async () => {
    try {
      const pr = await fetch("/api/subscription/plans", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const pd = (await pr.json().catch(() => ({}))) as PlansPayload;
      if (pd.success && Array.isArray(pd.plans)) setPlans(pd.plans);
      if (typeof pd.yearly_discount_percent === "number") setYearlyDisc(pd.yearly_discount_percent);
      if (pd.wallet_topup && typeof pd.wallet_topup === "object") setWalletTopupInfo(pd.wallet_topup);
      setWechatNativeEnabled(pd.payment_channels?.wechat_native?.enabled === true);
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
        usage?: Usage | null;
        orders?: OrderRow[];
        wallet_balance_cents?: number;
        subscription_checkout_intent?: { tier?: string; billing_cycle?: string } | null;
      };
      if (mr.ok && md.success) {
        setCurrentPlan(md.plan?.trim() ? md.plan : "free");
        setBillingCycle(md.billing_cycle ?? null);
        setUsage(md.usage ?? null);
        setOrders(Array.isArray(md.orders) ? md.orders : []);
        if (typeof md.wallet_balance_cents === "number") setWalletBalanceCents(md.wallet_balance_cents);
        else setWalletBalanceCents(null);
        const ci = md.subscription_checkout_intent;
        if (ci && typeof ci.tier === "string" && ci.tier.trim() && typeof ci.billing_cycle === "string") {
          setCheckoutIntent({ tier: ci.tier.trim(), billing_cycle: ci.billing_cycle.trim() });
        } else {
          setCheckoutIntent(null);
        }
      }
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void loadPlans();
    void loadMe();
  }, [loadPlans, loadMe]);

  useEffect(() => {
    const url = wechatPay?.code_url;
    if (!url) {
      setWechatQrDataUrl("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 220, margin: 2, errorCorrectionLevel: "M" })
      .then((data) => {
        if (!cancelled) setWechatQrDataUrl(data);
      })
      .catch(() => {
        if (!cancelled) setWechatQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [wechatPay?.code_url]);

  useEffect(() => {
    if (!wechatPay) return;
    const id = window.setInterval(() => {
      void loadMe();
    }, 2500);
    return () => window.clearInterval(id);
  }, [wechatPay, loadMe]);

  useEffect(() => {
    if (!wechatPay) return;
    const id = wechatPay.out_trade_no;
    const hit = orders.some((o) => {
      if (!o.event_id || o.event_id !== id) return false;
      const st = String(o.status || "").toLowerCase();
      return st === "paid" || st === "success" || st === "succeeded";
    });
    if (hit) {
      setWechatPay(null);
      setMsg("微信支付已成功入账");
      void refreshMe();
    }
  }, [orders, wechatPay, refreshMe]);

  const shownPlans = useMemo(() => (plans.length ? plans : FALLBACK_PLANS), [plans]);

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
        body: JSON.stringify({ tier, billing_cycle: tier === "free" ? null : cycle })
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

  async function createWechatSubscription(tier: string) {
    if (tier === "free") return;
    setWechatLoadingTier(tier);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/wechat-native/subscription", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ tier, billing_cycle: cycle })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        code_url?: string;
        out_trade_no?: string;
        amount_cents?: number;
        detail?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success || !data.code_url || !data.out_trade_no) {
        throw new Error(data.detail || data.error || `微信下单失败 ${res.status}`);
      }
      setWechatPay({
        kind: "subscription",
        code_url: data.code_url,
        out_trade_no: data.out_trade_no,
        amount_cents: Number(data.amount_cents ?? 0),
        tier
      });
      setMsg(data.message || "请使用微信扫码完成支付");
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setWechatLoadingTier(null);
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

  async function createWechatWalletTopup() {
    const parsed = parseTopupAmountCents();
    if (!parsed.ok) {
      setMsg(parsed.error);
      return;
    }
    setWechatWalletLoading(true);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/wechat-native/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ amount_cents: parsed.cents })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        code_url?: string;
        out_trade_no?: string;
        amount_cents?: number;
        detail?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success || !data.code_url || !data.out_trade_no) {
        throw new Error(data.detail || data.error || `微信充值下单失败 ${res.status}`);
      }
      setWechatPay({
        kind: "wallet",
        code_url: data.code_url,
        out_trade_no: data.out_trade_no,
        amount_cents: Number(data.amount_cents ?? parsed.cents)
      });
      setMsg(data.message || "请使用微信扫码完成充值");
    } catch (err) {
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setWechatWalletLoading(false);
    }
  }

  const supportEmail = typeof process.env.NEXT_PUBLIC_SUPPORT_EMAIL === "string" ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL : undefined;

  return (
    <main className="min-h-0 max-w-6xl">
      <PricingHero />

      <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted">
        选择适合你的方案。<strong className="text-ink">支付成功并完成入账后</strong>
        ，会员权益会自动更新；如有延迟，请稍候刷新本页。
      </p>

      {checkoutIntent ? (
        <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-center text-sm text-ink">
          已选开通意向：<span className="font-mono font-medium">{checkoutIntent.tier}</span> ·{" "}
          <span className="font-mono">{checkoutIntent.billing_cycle}</span>
          <span className="block text-xs text-muted">须完成支付后才会生效；Free 档无需支付。</span>
        </div>
      ) : null}

      {usage ? (
        <section className="mx-auto mt-8 max-w-2xl rounded-xl border border-line bg-surface/50 p-4">
          <h2 className="text-sm font-semibold text-ink">本月用量</h2>
          <p className="mt-2 text-sm text-muted">
            近 {usage.period_days ?? 30} 天内，已完成创作次数：{" "}
            <span className="font-mono text-ink">
              {usage.jobs_terminal ?? 0} / {usage.quota ?? "—"}
            </span>
            {typeof usage.percent === "number" ? (
              <span className="text-muted">（已用约 {usage.percent}%）</span>
            ) : null}
          </p>
          {walletBalanceCents != null ? (
            <p className="mt-2 text-sm text-muted">
              账户余额：{" "}
              <span className="font-mono text-ink">{fmtMoneyYuan(walletBalanceCents)}</span>
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">次数仅作会员档位参考，与第三方单独计费无关。</p>
        </section>
      ) : null}

      <PricingPlansGrid
        plans={shownPlans}
        cycle={cycle}
        onCycleChange={setCycle}
        yearlyDiscountPercent={yearlyDisc}
        currentPlanId={currentPlan}
        submittingTier={submittingTier}
        onSelectPlan={(tier) => void selectPlan(tier)}
        wechatNativeEnabled={wechatNativeEnabled}
        wechatLoadingTier={wechatLoadingTier}
        onWechatPay={(tier) => void createWechatSubscription(tier)}
      />

      {wechatPay ? (
        <section className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-surface/80 p-5 shadow-sm">
          <h2 className="text-center text-sm font-semibold text-ink">微信扫码支付</h2>
          <p className="mt-2 text-center text-xs text-muted">
            {wechatPay.kind === "subscription"
              ? `订阅 ${wechatPay.tier} · ${fmtMoneyYuan(wechatPay.amount_cents)}`
              : `钱包充值 · ${fmtMoneyYuan(wechatPay.amount_cents)}`}
          </p>
          <p className="mt-1 text-center font-mono text-[10px] text-muted">商户单号 {wechatPay.out_trade_no}</p>
          <div className="mt-4 flex justify-center">
            {wechatQrDataUrl ? (
              <img src={wechatQrDataUrl} width={220} height={220} className="rounded-lg border border-line bg-white p-2" alt="微信收款码" />
            ) : (
              <p className="text-sm text-muted">正在生成二维码…</p>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-muted">打开微信扫一扫，支付完成后本页会自动更新订单；也可手动刷新。</p>
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-fill"
              onClick={() => {
                setWechatPay(null);
                setWechatQrDataUrl("");
              }}
            >
              关闭二维码
            </button>
          </div>
        </section>
      ) : null}

      {walletTopupInfo?.checkout_supported !== false && walletTopupInfo ? (
        <section className="mt-12 rounded-xl border border-dashed border-line bg-fill/30 p-5">
          <h2 className="text-sm font-semibold text-ink">账户余额充值</h2>
          <p className="mt-1 text-xs text-muted">
            {walletTopupInfo.description ||
              "充值进入钱包（单位：人民币），用多少扣多少；单次最低 ¥10；不改变订阅档位。"}
          </p>
          <WalletUsageReference refData={walletTopupInfo.usage_reference} />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
              disabled={walletCreating || walletPaying || wechatWalletLoading || wechatLoadingTier != null}
              onClick={() => void createWalletOrder()}
            >
              {walletCreating ? "创建订单中…" : "去支付（模拟）"}
            </button>
            {wechatNativeEnabled ? (
              <button
                type="button"
                className="rounded-lg border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink hover:bg-fill disabled:opacity-50"
                disabled={walletCreating || walletPaying || wechatWalletLoading || wechatLoadingTier != null}
                onClick={() => void createWechatWalletTopup()}
              >
                {wechatWalletLoading ? "创建微信订单中…" : "微信扫码充值"}
              </button>
            ) : null}
          </div>
          {walletCheckout ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="text-xs text-muted">
                待支付 <span className="font-mono text-ink">{walletCheckout.checkout_id}</span> ·{" "}
                {fmtMoneyYuan(walletCheckout.amount_cents)}
              </p>
              <button
                type="button"
                className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
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
