"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { FaqAccordion } from "../../components/subscription/FaqAccordion";
import FormSheetModal from "../../components/subscription/FormSheetModal";
import { PricingHero } from "../../components/subscription/PricingHero";
import { WalletUsageReference } from "../../components/subscription/WalletUsageReference";
import type { WalletTopupPayload } from "../../components/subscription/types";
import { parseSubscriptionErrorBody } from "../../lib/subscriptionError";

type RechargeRecordRow = {
  serial_no?: string;
  provider_order_id?: string | null;
  recharged_at_unix?: number | null;
  channel_zh?: string;
  amount_cents?: number;
  currency?: string;
  result_zh?: string;
};

type ConsumptionRecordRow = {
  ledger_id?: number;
  job_id?: string;
  account_masked?: string;
  api_path?: string;
  feature_zh?: string;
  usage_detail_zh?: string;
  amount_cents?: number;
  consumed_at_unix?: number | null;
  result_zh?: string;
};

type PlansPayload = {
  success?: boolean;
  wallet_topup?: WalletTopupPayload;
  payment_channels?: {
    alipay_page?: { enabled?: boolean; label_zh?: string };
  };
};

/** 与编排器 billing_catalog 一致：支持 JSON 布尔或偶发的字符串/数字 */
function isTruthyPaymentChannelEnabled(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }
  return false;
}

function walletPayloadImpliesAlipayOnly(wt: WalletTopupPayload | null | undefined): boolean {
  if (!wt || typeof wt !== "object") return false;
  const c = wt.checkout_supported;
  if (c === false) return true;
  if (typeof c === "string") {
    const s = c.trim().toLowerCase();
    return s === "false" || s === "0" || s === "no" || s === "off";
  }
  return false;
}

type WalletCheckoutState = {
  checkout_id: string;
  amount_cents: number;
};

export default function SubscriptionPage() {
  const { getAuthHeaders, refreshMe, user } = useAuth();
  const [walletTopupInfo, setWalletTopupInfo] = useState<PlansPayload["wallet_topup"]>(undefined);
  const [rechargeRecords, setRechargeRecords] = useState<RechargeRecordRow[]>([]);
  const [consumptionRecords, setConsumptionRecords] = useState<ConsumptionRecordRow[]>([]);
  const [topupYuanInput, setTopupYuanInput] = useState("30");
  const [msg, setMsg] = useState("");
  const [walletCheckout, setWalletCheckout] = useState<WalletCheckoutState | null>(null);
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletPaying, setWalletPaying] = useState(false);
  const [alipayPageEnabled, setAlipayPageEnabled] = useState(false);
  const [alipayWalletLoading, setAlipayWalletLoading] = useState(false);
  const [plansConfigLoaded, setPlansConfigLoaded] = useState(false);
  const [plansLoadError, setPlansLoadError] = useState("");
  const [walletBalanceCents, setWalletBalanceCents] = useState<number | null>(null);
  const [experienceVoiceMin, setExperienceVoiceMin] = useState<number | null>(null);
  const [experienceTextChars, setExperienceTextChars] = useState<number | null>(null);
  const [rechargeModalOpen, setRechargeModalOpen] = useState(false);
  const [experienceVoiceTotal, setExperienceVoiceTotal] = useState<number | null>(null);
  const [experienceTextTotal, setExperienceTextTotal] = useState<number | null>(null);

  /** 防止连续多次 loadPlans 返回顺序错乱，把旧响应写回 state */
  const plansFetchSeqRef = useRef(0);

  const allowMockWallet =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_MOCK_WALLET === "1";

  const mergedWalletTopup = useMemo((): WalletTopupPayload => {
    const base: WalletTopupPayload = {
      enabled: true,
      checkout_supported: true,
      min_amount_cents: 1,
      max_amount_cents: 10_000_000,
      suggested_topup_yuan: [30, 50, 100],
      description: "",
      usage_reference: {
        podcast_yuan_per_minute: 0.25,
        text_yuan_per_10k_chars: 2,
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

  const suggestedTopupYuan = useMemo(() => {
    const raw = mergedWalletTopup.suggested_topup_yuan;
    if (Array.isArray(raw) && raw.length) {
      return raw.filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
    }
    return [30, 50, 100];
  }, [mergedWalletTopup.suggested_topup_yuan]);

  const showWalletRechargeSection = plansConfigLoaded && mergedWalletTopup.enabled !== false;

  /** 弹窗内是否展示支付宝收银：state 与 wallet_topup 双通道（防漏判与竞态） */
  const alipayRechargeUiEnabled = useMemo(
    () => alipayPageEnabled || walletPayloadImpliesAlipayOnly(mergedWalletTopup),
    [alipayPageEnabled, mergedWalletTopup]
  );

  const loadPlans = useCallback(async () => {
    const seq = ++plansFetchSeqRef.current;
    setPlansLoadError("");
    try {
      const pr = await fetch("/api/subscription/plans", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const pd = (await pr.json().catch(() => ({}))) as PlansPayload;
      if (seq !== plansFetchSeqRef.current) return;
      if (!pr.ok) {
        setAlipayPageEnabled(false);
        if (pr.status === 404) {
          setPlansLoadError("未找到计费配置接口（HTTP 404）。已使用本站参考价目；请确认 Next BFF 已部署 /api/subscription/plans 且编排器可访问。");
        } else {
          setPlansLoadError(`暂时无法拉取计费配置（HTTP ${pr.status}），已显示参考价目。`);
        }
        return;
      }
      if (pd.success) {
        const wtRaw = pd.wallet_topup && typeof pd.wallet_topup === "object" ? pd.wallet_topup : {};
        setWalletTopupInfo(wtRaw);
        const wt = Object.keys(wtRaw).length ? (wtRaw as WalletTopupPayload) : null;
        const fromChannel = isTruthyPaymentChannelEnabled(pd.payment_channels?.alipay_page?.enabled);
        const fromWallet = walletPayloadImpliesAlipayOnly(wt);
        setAlipayPageEnabled(fromChannel || fromWallet);
      } else {
        setAlipayPageEnabled(false);
        setPlansLoadError("计费接口返回异常，已显示参考价目，请稍后重试。");
      }
    } catch (e) {
      if (seq === plansFetchSeqRef.current) {
        setPlansLoadError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      if (seq === plansFetchSeqRef.current) {
        setPlansConfigLoaded(true);
      }
    }
  }, [getAuthHeaders]);

  const loadMe = useCallback(async () => {
    try {
      const mr = await fetch("/api/subscription/me", { headers: getAuthHeaders(), cache: "no-store" });
      const md = (await mr.json().catch(() => ({}))) as {
        success?: boolean;
        recharge_records?: RechargeRecordRow[];
        consumption_records?: ConsumptionRecordRow[];
        wallet_balance_cents?: number;
        experience?: {
          voice_minutes_remaining?: number;
          text_chars_remaining?: number;
          voice_minutes_total?: number | null;
          text_chars_total?: number | null;
        };
      };
      if (mr.ok && md.success) {
        setRechargeRecords(Array.isArray(md.recharge_records) ? md.recharge_records : []);
        setConsumptionRecords(Array.isArray(md.consumption_records) ? md.consumption_records : []);
        if (typeof md.wallet_balance_cents === "number") setWalletBalanceCents(md.wallet_balance_cents);
        else setWalletBalanceCents(null);
        const ex = md.experience;
        if (ex && typeof ex === "object") {
          if (typeof ex.voice_minutes_remaining === "number") setExperienceVoiceMin(ex.voice_minutes_remaining);
          else setExperienceVoiceMin(null);
          if (typeof ex.text_chars_remaining === "number") setExperienceTextChars(ex.text_chars_remaining);
          else setExperienceTextChars(null);
          setExperienceVoiceTotal(typeof ex.voice_minutes_total === "number" ? ex.voice_minutes_total : null);
          setExperienceTextTotal(typeof ex.text_chars_total === "number" ? ex.text_chars_total : null);
        } else {
          setExperienceVoiceMin(null);
          setExperienceTextChars(null);
          setExperienceVoiceTotal(null);
          setExperienceTextTotal(null);
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
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (!q.get("out_trade_no") && !q.get("trade_no")) return;
    void loadMe();
    void refreshMe();
    setMsg("支付已完成或处理中，正在同步订单…");
    window.history.replaceState({}, "", window.location.pathname);
  }, [loadMe, refreshMe]);

  const walletPayEnabled = isLoggedInAccountUser(user);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hash;
    if (h === "#wallet-topup" || h === "#recharge") {
      setRechargeModalOpen(true);
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!walletPayEnabled) return undefined;
    const tick = window.setInterval(() => {
      void loadMe();
    }, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void loadMe();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [walletPayEnabled, loadMe]);

  useEffect(() => {
    if (!rechargeModalOpen || !walletPayEnabled) return;
    void loadMe();
    void loadPlans();
  }, [rechargeModalOpen, walletPayEnabled, loadMe, loadPlans]);

  useEffect(() => {
    if (!showWalletRechargeSection) setRechargeModalOpen(false);
  }, [showWalletRechargeSection]);

  function fmtTimeUnix(ts?: number | null) {
    if (ts == null || typeof ts !== "number" || !Number.isFinite(ts)) return "—";
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

  function experienceVoiceUsedTotalLabel(rem: number, tot: number): string {
    const used = Math.max(0, Math.min(tot, tot - rem));
    return `${used.toFixed(2)} / ${tot.toFixed(2)} 分钟`;
  }

  function experienceTextUsedTotalLabel(rem: number, tot: number): string {
    const ri = Math.floor(rem);
    const used = Math.max(0, Math.min(tot, tot - ri));
    return `${used.toLocaleString()} / ${tot.toLocaleString()} 字`;
  }

  function parseTopupAmountCents(): { ok: true; cents: number } | { ok: false; error: string } {
    const minC =
      typeof mergedWalletTopup.min_amount_cents === "number" ? mergedWalletTopup.min_amount_cents : 1;
    const maxC =
      typeof mergedWalletTopup.max_amount_cents === "number" ? mergedWalletTopup.max_amount_cents : 10_000_000;
    const y = Number(String(topupYuanInput || "").replace(/,/g, "").trim());
    if (!Number.isFinite(y) || y <= 0) return { ok: false, error: "请输入有效的充值金额（元）" };
    const cents = Math.round(y * 100);
    if (cents < minC) return { ok: false, error: `充值金额需至少 ${(minC / 100).toFixed(2)} 元` };
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
      setMsg("余额已入账");
      setWalletCheckout(null);
      await loadMe();
      await refreshMe();
      setRechargeModalOpen(false);
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
      const res = await fetch("/api/subscription/recharge", {
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

  const topupAmountParse = parseTopupAmountCents();

  return (
    <main className="min-h-0 max-w-6xl">
      <PricingHero title="余额与账单" />

      {plansLoadError ? (
        <p className="mb-4 rounded-lg border border-warning/35 bg-warning-soft/90 px-3 py-2 text-sm text-warning-ink" role="alert">
          {plansLoadError}
          若编排器未启动或网络异常，将无法调起支付宝；本地开发请先启动 orchestrator。
        </p>
      ) : null}

      <section
        id="balance-billing"
        className="mt-8 scroll-mt-24 rounded-xl border border-line bg-surface/60 p-5 shadow-sm"
        aria-labelledby="balance-billing-title"
      >
        <h2 id="balance-billing-title" className="text-base font-semibold text-ink">
          我的余额
        </h2>
        {walletPayEnabled ? (
          <>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">
              {walletBalanceCents != null ? (
                <span className="font-mono">{fmtMoneyYuan(walletBalanceCents)}</span>
              ) : (
                <span className="text-sm font-normal text-muted">加载中…</span>
              )}
            </p>
            {(experienceVoiceTotal != null && experienceVoiceMin != null) ||
            (experienceTextTotal != null && experienceTextChars != null) ? (
              <p className="mt-2 text-xs text-ink">
                <span className="font-medium text-muted">体验包（已用 / 总量）</span>
                {experienceVoiceTotal != null && experienceVoiceMin != null ? (
                  <span className="ml-2 font-mono">
                    语音 {experienceVoiceUsedTotalLabel(experienceVoiceMin, experienceVoiceTotal)}
                  </span>
                ) : null}
                {experienceTextTotal != null && experienceTextChars != null ? (
                  <span className="ml-2 font-mono">
                    文本 {experienceTextUsedTotalLabel(experienceTextChars, experienceTextTotal)}
                  </span>
                ) : null}
              </p>
            ) : experienceVoiceMin != null || experienceTextChars != null ? (
              <p className="mt-2 text-xs text-ink">
                <span className="font-medium text-muted">体验包剩余</span>
                {experienceVoiceMin != null ? (
                  <span className="ml-2 font-mono">语音 {experienceVoiceMin.toFixed(2)} 分钟</span>
                ) : null}
                {experienceTextChars != null ? (
                  <span className="ml-2 font-mono">文本 {experienceTextChars.toLocaleString()} 字</span>
                ) : null}
              </p>
            ) : null}
            {showWalletRechargeSection ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:bg-cta/90"
                  onClick={() => setRechargeModalOpen(true)}
                >
                  充值
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">请登录后查看余额、体验包余量与账单流水。</p>
        )}
      </section>

      <section className="mt-10 space-y-10">
        <div>
          <h2 className="text-lg font-semibold text-ink">充值记录</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface/40">
            <table className="min-w-[640px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">流水号</th>
                  <th className="px-3 py-2">充值时间</th>
                  <th className="px-3 py-2">充值渠道</th>
                  <th className="px-3 py-2">充值金额</th>
                  <th className="px-3 py-2">充值结果</th>
                </tr>
              </thead>
              <tbody>
                {rechargeRecords.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted">
                      暂无
                    </td>
                  </tr>
                ) : (
                  rechargeRecords.map((r, idx) => (
                    <tr
                      key={r.serial_no ? String(r.serial_no) : `rch_${idx}`}
                      className="border-t border-line/80"
                    >
                      <td className="max-w-[14rem] px-3 py-2 font-mono text-[11px]" title={r.provider_order_id || r.serial_no}>
                        {r.serial_no || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{fmtTimeUnix(r.recharged_at_unix)}</td>
                      <td className="px-3 py-2 text-xs">{r.channel_zh || "—"}</td>
                      <td className="px-3 py-2 font-mono">{fmtMoneyYuan(r.amount_cents)}</td>
                      <td className="px-3 py-2 text-xs">{r.result_zh || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-ink">消费记录</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface/40">
            <table className="min-w-[960px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">消费账号</th>
                  <th className="px-3 py-2">消费接口</th>
                  <th className="px-3 py-2">消费功能</th>
                  <th className="px-3 py-2">消费时长/字数</th>
                  <th className="px-3 py-2">消费金额</th>
                  <th className="px-3 py-2">消费时间</th>
                  <th className="px-3 py-2">消费结果</th>
                </tr>
              </thead>
              <tbody>
                {consumptionRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted">
                      暂无
                    </td>
                  </tr>
                ) : (
                  consumptionRecords.map((c) => (
                    <tr key={`${c.ledger_id}_${c.job_id}`} className="border-t border-line/80">
                      <td className="px-3 py-2 font-mono text-xs">{c.account_masked || "—"}</td>
                      <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-[10px]" title={c.api_path}>
                        {c.api_path || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{c.feature_zh || "—"}</td>
                      <td className="max-w-[18rem] px-3 py-2 text-xs text-muted">{c.usage_detail_zh || "—"}</td>
                      <td className="px-3 py-2 font-mono">{fmtMoneyYuan(c.amount_cents ?? 0)}</td>
                      <td className="px-3 py-2 text-xs text-muted">{fmtTimeUnix(c.consumed_at_unix)}</td>
                      <td className="px-3 py-2 text-xs">{c.result_zh || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {showWalletRechargeSection ? (
        <FormSheetModal
          open={rechargeModalOpen}
          titleId="wallet-recharge-modal-title"
          title="账户充值"
          onClose={() => setRechargeModalOpen(false)}
        >
          {alipayRechargeUiEnabled ? (
            <p className="text-xs text-muted">
              点击下方按钮将跳转至支付宝收银台；请使用手机支付宝扫码完成付款。支付完成后返回订阅页即可看到更新后的余额。
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex max-w-md flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">充值金额（元）</span>
                <input
                  type="number"
                  min={(mergedWalletTopup.min_amount_cents ?? 1) / 100}
                  step="0.01"
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-ink"
                  value={topupYuanInput}
                  onChange={(e) => setTopupYuanInput(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {suggestedTopupYuan.map((yuan) => (
                  <button
                    key={yuan}
                    type="button"
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
                    onClick={() => setTopupYuanInput(String(yuan))}
                  >
                    ¥{yuan}
                  </button>
                ))}
              </div>
            </div>
            {alipayRechargeUiEnabled ? (
              <div className="flex max-w-md flex-col gap-2">
                {topupAmountParse.ok ? (
                  <p className="text-sm text-ink">
                    本次充值{" "}
                    <span className="font-mono text-base font-semibold tabular-nums">
                      ¥{(topupAmountParse.cents / 100).toFixed(2)}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-warning-ink" role="alert">
                    {topupAmountParse.error}
                  </p>
                )}
                <button
                  type="button"
                  className="w-full rounded-xl bg-cta px-4 py-3 text-base font-semibold text-cta-foreground shadow-sm hover:bg-cta/90 disabled:opacity-50"
                  disabled={
                    !topupAmountParse.ok ||
                    walletCreating ||
                    walletPaying ||
                    alipayWalletLoading ||
                    !walletPayEnabled
                  }
                  aria-busy={alipayWalletLoading}
                  onClick={() => void createAlipayWalletTopup()}
                >
                  {alipayWalletLoading ? "正在打开支付宝…" : "立即支付（跳转支付宝）"}
                </button>
                <p className="text-center text-[11px] leading-snug text-muted">
                  点击后将离开本站并打开支付宝官方收银台页面；支付完成后可从浏览器返回本页刷新余额。
                </p>
              </div>
            ) : allowMockWallet && mergedWalletTopup.checkout_supported !== false ? (
              <button
                type="button"
                className="w-fit rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:bg-cta/90 disabled:opacity-50"
                disabled={walletCreating || walletPaying || alipayWalletLoading || !walletPayEnabled}
                onClick={() => void createWalletOrder()}
              >
                {walletCreating ? "创建订单中…" : "去支付（内测模拟）"}
              </button>
            ) : (
              <div className="max-w-md space-y-2 text-xs text-muted">
                <p>
                  当前未检测到可用的支付宝收银配置。请确认编排器已设置{" "}
                  <code className="rounded bg-fill px-1">ALIPAY_PAY_ENABLED=1</code> 及完整{" "}
                  <code className="rounded bg-fill px-1">ALIPAY_*</code>，且 Next 能访问编排器{" "}
                  <code className="rounded bg-fill px-1">/api/v1/subscription/plans</code>。
                </p>
                <button
                  type="button"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
                  onClick={() => void loadPlans()}
                >
                  重新同步计费配置
                </button>
              </div>
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
          <div className="mt-6 border-t border-line/80 pt-4">
            <WalletUsageReference refData={mergedWalletTopup.usage_reference} />
          </div>
        </FormSheetModal>
      ) : null}

      <FaqAccordion />

      {msg ? <p className="mt-4 text-center text-sm text-muted">{msg}</p> : null}
    </main>
  );
}
