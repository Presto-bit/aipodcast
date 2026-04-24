"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { FaqAccordion } from "../../components/subscription/FaqAccordion";
import FormSheetModal from "../../components/subscription/FormSheetModal";
import { PricingHero } from "../../components/subscription/PricingHero";
import { WalletUsageReference } from "../../components/subscription/WalletUsageReference";
import type { WalletTopupPayload } from "../../components/subscription/types";
import { parseSubscriptionErrorBody } from "../../lib/subscriptionError";
import {
  RECHARGE_DEBUG_EVENT,
  appendRechargeDebug,
  clearRechargeDebug,
  newRechargeDebugRequestId,
  readRechargeDebug,
  rechargePathLogVisibleForUser,
  summarizePayUrl,
  type RechargeDebugEntry
} from "../../lib/rechargeClientDebug";

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

/** 从支付宝同步回跳后用于短时拉余额，避免仅依赖 30s 轮询 */
const WALLET_ALIPAY_PENDING_KEY = "subscription_alipay_wallet_pending";

type WalletAlipayPendingPayload = {
  startedAt: number;
  balanceBeforeCents: number | null;
  /** 跳转支付前「充值记录」条数；用于首充或余额尚未加载时仍能检测入账 */
  rechargeCountBefore?: number;
  /** 商户订单号；异步通知缺失时用于服务端 alipay.trade.query 主动对账 */
  outTradeNo?: string;
  /**
   * 回到订阅页后「轮询同步」的绝对截止时间（epoch ms），写入 sessionStorage，
   * 避免 Strict Mode / 路由重挂载反复重置 setInterval 导致永远达不到 maxTicks。
   */
  pollDeadlineAt?: number;
};

/** 设为 1 时：拉取 /api/subscription/plans 后在控制台与充值弹窗输出结构化诊断（需重新 build Next） */
function subscriptionPlansDebugEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUBSCRIPTION_PLANS_DEBUG === "1";
}

type PlansLoadDiag = {
  ts: string;
  branch:
    | "http_error"
    | "success_false"
    | "success_true"
    | "network_error"
    | "stale_response_skipped";
  http_ok?: boolean;
  http_status?: number;
  pd_success?: boolean;
  payment_channels_alipay_page_enabled_raw?: unknown;
  wallet_topup_checkout_supported_raw?: unknown;
  wallet_topup_key_count?: number;
  wallet_topup_empty?: boolean;
  from_channel_flag?: boolean;
  from_wallet_flag?: boolean;
  set_alipay_page_enabled_to?: boolean;
  plans_load_error_message?: string;
  hint_zh?: string;
};

function buildPlansLoadHintZh(d: PlansLoadDiag): string {
  if (d.branch === "network_error") {
    return "请求 /api/subscription/plans 失败（网络异常或未捕获错误），未完成价目拉取。";
  }
  if (d.branch === "stale_response_skipped") {
    return "存在更新的拉取请求，本响应已丢弃（多为快速重复打开弹窗）。";
  }
  if (d.branch === "http_error") {
    return `Next BFF 或上游编排器返回 HTTP ${d.http_status ?? "?"}，未拿到价目 JSON；请查编排器可达性、网关与 /api/subscription/plans 路由。`;
  }
  if (d.branch === "success_false") {
    return "响应体 success 不为 true，前端关闭支付宝通道；请查编排器该接口业务错误与日志。";
  }
  if (d.branch === "success_true") {
    if (d.from_channel_flag) {
      return "payment_channels.alipay_page.enabled 判定为真，编排器侧已声明支付宝可用。";
    }
    if (d.from_wallet_flag) {
      return "由 wallet_topup.checkout_supported===false 推断走支付宝（与编排器「已就绪支付宝」时一致）。";
    }
    if (d.wallet_topup_empty) {
      return "wallet_topup 几乎为空，合并了前端兜底价目；此时完全依赖 payment_channels.alipay_page.enabled，当前为假 → 编排器仍判定支付宝未就绪（ALIPAY_* / 密钥可读性 / NOTIFY 推导 RETURN 等）。";
    }
    return "payment_channels.alipay_page.enabled 为假，且 wallet_topup 未暗示仅支付宝 → 编排器未就绪或字段未下发。";
  }
  return "";
}

function logSubscriptionPlansDiag(d: PlansLoadDiag): void {
  if (!subscriptionPlansDebugEnabled()) return;
  const hint = d.hint_zh || buildPlansLoadHintZh(d);
  const payload = { ...d, hint_zh: hint };
  console.info("[subscription/plans 诊断]", payload);
}

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
  // 运行时 JSON 可能偶发非布尔；避免用 WalletTopupPayload 收窄成 never
  const c = (wt as { checkout_supported?: unknown }).checkout_supported;
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

/** 「我的余额」上方展示的充值链路日志：优先支付宝相关步骤，否则退化为最近几条 */
function entriesForBalanceAlipayLog(entries: RechargeDebugEntry[]): RechargeDebugEntry[] {
  const pick = (e: RechargeDebugEntry) =>
    e.step.startsWith("alipay_") ||
    e.step === "url_query_trade_params" ||
    e.step.startsWith("sim_wallet_") ||
    e.step === "load_me" ||
    e.step === "load_me_not_ok" ||
    e.step === "load_me_error";
  const filtered = entries.filter(pick);
  const tail = filtered.slice(-24);
  if (tail.length) return tail;
  return entries.slice(-10);
}

export default function SubscriptionPage() {
  const { getAuthHeaders, refreshMe, user } = useAuth();
  const [walletTopupInfo, setWalletTopupInfo] = useState<PlansPayload["wallet_topup"]>(undefined);
  const [rechargeRecords, setRechargeRecords] = useState<RechargeRecordRow[]>([]);
  const [consumptionRecords, setConsumptionRecords] = useState<ConsumptionRecordRow[]>([]);
  const [consumptionSince, setConsumptionSince] = useState("");
  const [consumptionUntil, setConsumptionUntil] = useState("");
  const [consumptionFilteredTotalCents, setConsumptionFilteredTotalCents] = useState<number | null>(null);
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
  const [plansLoadDiag, setPlansLoadDiag] = useState<PlansLoadDiag | null>(null);
  const [rechargeDebugLog, setRechargeDebugLog] = useState<RechargeDebugEntry[]>([]);
  const [rechargeDebugUiReady, setRechargeDebugUiReady] = useState(false);

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

  /** 编排器未就绪支付宝时，仍可用模拟收银入账（与 SIMULATED_WALLET_CHECKOUT_ENABLED 一致，默认开启） */
  const showSimulatedWalletTopup = useMemo(
    () => !alipayRechargeUiEnabled && mergedWalletTopup.checkout_supported !== false,
    [alipayRechargeUiEnabled, mergedWalletTopup.checkout_supported]
  );

  const rechargePathLogEntries = useMemo(
    () => entriesForBalanceAlipayLog(rechargeDebugLog),
    [rechargeDebugLog]
  );

  useEffect(() => {
    if (!subscriptionPlansDebugEnabled() || !plansConfigLoaded) return;
    console.info("[subscription 合并态诊断]", {
      alipayPageEnabled,
      alipayRechargeUiEnabled,
      allowMockWallet,
      merged_wallet_topup_enabled: mergedWalletTopup.enabled,
      merged_wallet_checkout_supported: mergedWalletTopup.checkout_supported,
      showWalletRechargeSection
    });
  }, [
    plansConfigLoaded,
    alipayPageEnabled,
    alipayRechargeUiEnabled,
    allowMockWallet,
    mergedWalletTopup.enabled,
    mergedWalletTopup.checkout_supported,
    showWalletRechargeSection
  ]);

  const loadPlans = useCallback(async () => {
    const seq = ++plansFetchSeqRef.current;
    setPlansLoadError("");
    if (!subscriptionPlansDebugEnabled()) setPlansLoadDiag(null);
    try {
      const pr = await fetch("/api/subscription/plans", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const pd = (await pr.json().catch(() => ({}))) as PlansPayload;
      if (seq !== plansFetchSeqRef.current) {
        const stale: PlansLoadDiag = {
          ts: new Date().toISOString(),
          branch: "stale_response_skipped",
          http_ok: pr.ok,
          http_status: pr.status,
          hint_zh: buildPlansLoadHintZh({ ts: "", branch: "stale_response_skipped" })
        };
        logSubscriptionPlansDiag(stale);
        if (subscriptionPlansDebugEnabled()) setPlansLoadDiag(stale);
        return;
      }
      if (!pr.ok) {
        setAlipayPageEnabled(false);
        if (pr.status === 404) {
          setPlansLoadError("未找到计费配置接口（HTTP 404）。已使用本站参考价目；请确认 Next BFF 已部署 /api/subscription/plans 且编排器可访问。");
        } else {
          setPlansLoadError(`暂时无法拉取计费配置（HTTP ${pr.status}），已显示参考价目。`);
        }
        const errDiag: PlansLoadDiag = {
          ts: new Date().toISOString(),
          branch: "http_error",
          http_ok: pr.ok,
          http_status: pr.status,
          pd_success: typeof pd.success === "boolean" ? pd.success : undefined,
          plans_load_error_message:
            pr.status === 404
              ? "HTTP 404：未找到计费配置接口"
              : `HTTP ${pr.status}：暂时无法拉取计费配置`
        };
        errDiag.hint_zh = buildPlansLoadHintZh(errDiag);
        logSubscriptionPlansDiag(errDiag);
        if (subscriptionPlansDebugEnabled()) setPlansLoadDiag(errDiag);
        return;
      }
      if (pd.success) {
        const wtRaw = pd.wallet_topup && typeof pd.wallet_topup === "object" ? pd.wallet_topup : {};
        setWalletTopupInfo(wtRaw);
        const wt = Object.keys(wtRaw).length ? (wtRaw as WalletTopupPayload) : null;
        const fromChannel = isTruthyPaymentChannelEnabled(pd.payment_channels?.alipay_page?.enabled);
        const fromWallet = walletPayloadImpliesAlipayOnly(wt);
        const enabledNext = fromChannel || fromWallet;
        setAlipayPageEnabled(enabledNext);
        const wtKeys = Object.keys(wtRaw);
        const csRaw = wt && typeof wt === "object" ? (wt as { checkout_supported?: unknown }).checkout_supported : undefined;
        const okDiag: PlansLoadDiag = {
          ts: new Date().toISOString(),
          branch: "success_true",
          http_ok: true,
          http_status: pr.status,
          pd_success: true,
          payment_channels_alipay_page_enabled_raw: pd.payment_channels?.alipay_page?.enabled,
          wallet_topup_checkout_supported_raw: csRaw,
          wallet_topup_key_count: wtKeys.length,
          wallet_topup_empty: wtKeys.length === 0,
          from_channel_flag: fromChannel,
          from_wallet_flag: fromWallet,
          set_alipay_page_enabled_to: enabledNext
        };
        okDiag.hint_zh = buildPlansLoadHintZh(okDiag);
        logSubscriptionPlansDiag(okDiag);
        if (subscriptionPlansDebugEnabled()) setPlansLoadDiag(okDiag);
      } else {
        setAlipayPageEnabled(false);
        setPlansLoadError("计费接口返回异常，已显示参考价目，请稍后重试。");
        const badDiag: PlansLoadDiag = {
          ts: new Date().toISOString(),
          branch: "success_false",
          http_ok: true,
          http_status: pr.status,
          pd_success: false,
          payment_channels_alipay_page_enabled_raw: pd.payment_channels?.alipay_page?.enabled,
          plans_load_error_message: "success 不为 true"
        };
        badDiag.hint_zh = buildPlansLoadHintZh(badDiag);
        logSubscriptionPlansDiag(badDiag);
        if (subscriptionPlansDebugEnabled()) setPlansLoadDiag(badDiag);
      }
    } catch (e) {
      if (seq === plansFetchSeqRef.current) {
        const msg = String(e instanceof Error ? e.message : e);
        setPlansLoadError(msg);
        const netDiag: PlansLoadDiag = {
          ts: new Date().toISOString(),
          branch: "network_error",
          plans_load_error_message: msg
        };
        netDiag.hint_zh = buildPlansLoadHintZh(netDiag);
        logSubscriptionPlansDiag(netDiag);
        if (subscriptionPlansDebugEnabled()) setPlansLoadDiag(netDiag);
      }
    } finally {
      if (seq === plansFetchSeqRef.current) {
        setPlansConfigLoaded(true);
      }
    }
  }, [getAuthHeaders]);

  const loadMe = useCallback(async (filterSince?: string, filterUntil?: string) => {
    const rid = newRechargeDebugRequestId();
    try {
      const sUse = filterSince !== undefined ? filterSince : consumptionSince;
      const tUse = filterUntil !== undefined ? filterUntil : consumptionUntil;
      const qs = new URLSearchParams();
      if (sUse.trim()) qs.set("consumption_since", sUse.trim());
      if (tUse.trim()) qs.set("consumption_until", tUse.trim());
      const mePath = qs.toString() ? `/api/subscription/me?${qs.toString()}` : "/api/subscription/me";
      const mr = await fetch(mePath, {
        headers: { ...getAuthHeaders(), "x-request-id": rid },
        cache: "no-store"
      });
      const md = (await mr.json().catch(() => ({}))) as {
        success?: boolean;
        recharge_records?: RechargeRecordRow[];
        consumption_records?: ConsumptionRecordRow[];
        consumption_filtered_wallet_total_cents?: number | null;
        wallet_balance_cents?: number;
        experience?: {
          voice_minutes_remaining?: number;
          text_chars_remaining?: number;
          voice_minutes_total?: number | null;
          text_chars_total?: number | null;
        };
      };
      appendRechargeDebug(
        "load_me",
        {
          path: mePath,
          http_ok: mr.ok,
          success: Boolean(md.success),
          wallet_balance_cents: typeof md.wallet_balance_cents === "number" ? md.wallet_balance_cents : null,
          recharge_records_len: Array.isArray(md.recharge_records) ? md.recharge_records.length : null
        },
        rid,
        user
      );
      if (mr.ok && md.success) {
        setRechargeRecords(Array.isArray(md.recharge_records) ? md.recharge_records : []);
        setConsumptionRecords(Array.isArray(md.consumption_records) ? md.consumption_records : []);
        if (typeof md.consumption_filtered_wallet_total_cents === "number") {
          setConsumptionFilteredTotalCents(md.consumption_filtered_wallet_total_cents);
        } else {
          setConsumptionFilteredTotalCents(null);
        }
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
      } else {
        appendRechargeDebug(
          "load_me_not_ok",
          { path: mePath, http_ok: mr.ok, success: md.success, http_status: mr.status },
          rid,
          user
        );
      }
    } catch (e) {
      appendRechargeDebug(
        "load_me_error",
        { message: String(e instanceof Error ? e.message : e) },
        rid,
        user
      );
    }
  }, [getAuthHeaders, consumptionSince, consumptionUntil, user]);

  const loadMeRef = useRef(loadMe);
  loadMeRef.current = loadMe;

  const reconcileAlipayWalletTopup = useCallback(
    async (outTradeNo: string) => {
      const otn = String(outTradeNo || "").trim();
      if (!otn) return;
      if (reconcileAlipayInFlightRef.current) return;
      reconcileAlipayInFlightRef.current = true;
      try {
        const res = await fetch("/api/subscription/reconcile-alipay-wallet", {
          method: "POST",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ out_trade_no: otn }),
          credentials: "same-origin"
        });
        const text = await res.text();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          /* noop */
        }
        appendRechargeDebug(
          "alipay_wallet_reconcile",
          {
            http_ok: res.ok,
            http_status: res.status,
            applied: data.applied,
            detail: data.detail,
            trade_status: data.trade_status,
            wallet_balance_cents: data.wallet_balance_cents
          },
          undefined,
          user
        );
      } catch (e) {
        appendRechargeDebug(
          "alipay_wallet_reconcile_err",
          { message: String(e instanceof Error ? e.message : e) },
          undefined,
          user
        );
      } finally {
        reconcileAlipayInFlightRef.current = false;
      }
    },
    [getAuthHeaders, user]
  );
  const reconcileAlipayWalletTopupRef = useRef(reconcileAlipayWalletTopup);
  reconcileAlipayWalletTopupRef.current = reconcileAlipayWalletTopup;
  /** 避免 Strict Mode / URL 回跳与轮询同时触发多笔并行对账，引发库侧竞争 */
  const reconcileAlipayInFlightRef = useRef(false);

  useEffect(() => {
    setRechargeDebugUiReady(true);
  }, []);

  const refreshRechargeDebugLog = useCallback(() => {
    setRechargeDebugLog(readRechargeDebug());
  }, []);

  useEffect(() => {
    refreshRechargeDebugLog();
    if (typeof window === "undefined" || !rechargePathLogVisibleForUser(user)) return undefined;
    const fn = () => refreshRechargeDebugLog();
    window.addEventListener(RECHARGE_DEBUG_EVENT, fn);
    return () => window.removeEventListener(RECHARGE_DEBUG_EVENT, fn);
  }, [refreshRechargeDebugLog, user]);

  useEffect(() => {
    void loadPlans();
    void loadMe();
  }, [loadPlans, loadMe]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (!q.get("out_trade_no") && !q.get("trade_no")) return;
    appendRechargeDebug(
      "url_query_trade_params",
      {
        has_out_trade_no: Boolean(q.get("out_trade_no")),
        has_trade_no: Boolean(q.get("trade_no"))
      },
      undefined,
      user
    );
    const otnUrl = (q.get("out_trade_no") || "").trim();
    if (otnUrl) void reconcileAlipayWalletTopup(otnUrl);
    void loadMe();
    void refreshMe();
    setMsg("支付已完成或处理中，正在同步订单…");
    window.history.replaceState({}, "", window.location.pathname);
  }, [loadMe, refreshMe, user, reconcileAlipayWalletTopup]);

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

  /** 支付宝页付回跳后（return_url 常不带单号）：短时轮询 /me，待异步通知入账后几秒内刷新余额 */
  useEffect(() => {
    if (!walletPayEnabled || typeof window === "undefined") return undefined;
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(WALLET_ALIPAY_PENDING_KEY);
    } catch {
      return undefined;
    }
    if (!raw) return undefined;
    let p: WalletAlipayPendingPayload;
    try {
      p = JSON.parse(raw) as WalletAlipayPendingPayload;
    } catch {
      try {
        sessionStorage.removeItem(WALLET_ALIPAY_PENDING_KEY);
      } catch {
        /* noop */
      }
      return undefined;
    }
    if (!p || typeof p.startedAt !== "number") {
      try {
        sessionStorage.removeItem(WALLET_ALIPAY_PENDING_KEY);
      } catch {
        /* noop */
      }
      return undefined;
    }
    if (Date.now() - p.startedAt > 10 * 60 * 1000) {
      try {
        sessionStorage.removeItem(WALLET_ALIPAY_PENDING_KEY);
      } catch {
        /* noop */
      }
      setMsg(
        "返回同步状态已超过 10 分钟，已停止自动拉取。若支付宝已付款仍未到账，请查异步通知与编排器日志，或刷新本页查看「充值记录」。"
      );
      return undefined;
    }

    const pollMs = 2500;
    const pollMaxWallMs = 100_000;
    const timeoutMsgZh = () =>
      `已自动拉取约 ${Math.round(
        pollMaxWallMs / 1000
      )} 秒仍未检测到入账。若支付宝已扣款：常见为异步通知未到编排器（请查 BFF→编排器 INTERNAL_SIGNING_SECRET、ALIPAY_NOTIFY_URL 与开放平台是否一致）；系统已并行尝试 trade.query 主动对账。仍无记录请刷新或稍后在「充值记录」中确认。`;

    let deadline =
      typeof p.pollDeadlineAt === "number" && Number.isFinite(p.pollDeadlineAt) ? p.pollDeadlineAt : 0;

    if (deadline > 0 && Date.now() >= deadline) {
      try {
        sessionStorage.removeItem(WALLET_ALIPAY_PENDING_KEY);
      } catch {
        /* noop */
      }
      setMsg(timeoutMsgZh());
      return undefined;
    }

    if (!deadline || deadline < Date.now()) {
      try {
        const fresh: WalletAlipayPendingPayload = { ...p, pollDeadlineAt: Date.now() + pollMaxWallMs };
        sessionStorage.setItem(WALLET_ALIPAY_PENDING_KEY, JSON.stringify(fresh));
        p = fresh;
        deadline = fresh.pollDeadlineAt!;
      } catch {
        /* noop */
      }
    }

    setMsg("已从支付宝返回，正在同步余额（通常几秒内完成）…");
    appendRechargeDebug(
      "alipay_return_poll_start",
      {
        interval_ms: pollMs,
        poll_deadline_at: deadline,
        balance_before_cents: typeof p.balanceBeforeCents === "number" ? p.balanceBeforeCents : null
      },
      undefined,
      user
    );

    let finished = false;
    const finishPoll = (reason: string) => {
      if (finished) return;
      finished = true;
      try {
        sessionStorage.removeItem(WALLET_ALIPAY_PENDING_KEY);
      } catch {
        /* noop */
      }
      setMsg(timeoutMsgZh());
      appendRechargeDebug("alipay_return_poll_end", { reason }, undefined, user);
    };

    const tick = () => {
      try {
        const r = sessionStorage.getItem(WALLET_ALIPAY_PENDING_KEY);
        if (r) {
          const parsed = JSON.parse(r) as WalletAlipayPendingPayload;
          const otn = typeof parsed.outTradeNo === "string" ? parsed.outTradeNo.trim() : "";
          if (otn) void reconcileAlipayWalletTopupRef.current(otn);
        }
      } catch {
        /* noop */
      }
      void loadMeRef.current();
    };
    tick();

    const readDeadline = (): number => {
      try {
        const r = sessionStorage.getItem(WALLET_ALIPAY_PENDING_KEY);
        if (!r) return deadline;
        const parsed = JSON.parse(r) as WalletAlipayPendingPayload;
        if (typeof parsed.pollDeadlineAt === "number" && Number.isFinite(parsed.pollDeadlineAt)) {
          return parsed.pollDeadlineAt;
        }
      } catch {
        /* noop */
      }
      return deadline;
    };

    const id = window.setInterval(() => {
      tick();
      if (Date.now() >= readDeadline()) {
        window.clearInterval(id);
        window.clearTimeout(backupTimer);
        finishPoll("deadline_wall");
      }
    }, pollMs);

    const remaining = Math.max(0, readDeadline() - Date.now());
    const backupTimer = window.setTimeout(() => {
      window.clearInterval(id);
      finishPoll("deadline_backup_timeout");
    }, remaining + 800);

    return () => {
      finished = true;
      window.clearInterval(id);
      window.clearTimeout(backupTimer);
    };
  }, [walletPayEnabled, user, reconcileAlipayWalletTopup]);

  useEffect(() => {
    if (!walletPayEnabled || typeof window === "undefined") return;
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(WALLET_ALIPAY_PENDING_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let p: WalletAlipayPendingPayload;
    try {
      p = JSON.parse(raw) as WalletAlipayPendingPayload;
    } catch {
      return;
    }
    const beforeCount = typeof p.rechargeCountBefore === "number" ? p.rechargeCountBefore : null;
    const balanceIncreased =
      typeof p.balanceBeforeCents === "number" &&
      typeof walletBalanceCents === "number" &&
      walletBalanceCents > p.balanceBeforeCents;
    const recordsIncreased = beforeCount !== null && rechargeRecords.length > beforeCount;
    if (balanceIncreased || recordsIncreased) {
      try {
        sessionStorage.removeItem(WALLET_ALIPAY_PENDING_KEY);
      } catch {
        /* noop */
      }
      setMsg("充值已入账，余额已更新。");
      appendRechargeDebug(
        "alipay_pending_cleared_balance_increased",
        {
          balance_before_cents: p.balanceBeforeCents,
          balance_after_cents: walletBalanceCents,
          recharge_count_before: beforeCount,
          recharge_count_after: rechargeRecords.length,
          via: balanceIncreased ? "balance" : "recharge_records"
        },
        undefined,
        user
      );
    }
  }, [walletPayEnabled, walletBalanceCents, rechargeRecords.length, user]);

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
    const rid = newRechargeDebugRequestId();
    appendRechargeDebug("sim_wallet_create_start", { amount_cents: parsed.cents }, rid, user);
    setWalletCreating(true);
    setMsg("");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/wallet-checkout/create", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": rid, ...getAuthHeaders() },
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
      appendRechargeDebug(
        "sim_wallet_create_ok",
        { http_status: res.status, checkout_id_tail: String(data.checkout_id).slice(-12) },
        rid,
        user
      );
      setWalletCheckout({
        checkout_id: data.checkout_id,
        amount_cents: Number(data.amount_cents ?? parsed.cents)
      });
      setMsg(data.message || "已创建收银会话，请确认支付");
    } catch (err) {
      appendRechargeDebug(
        "sim_wallet_create_error",
        { message: String(err instanceof Error ? err.message : err) },
        rid,
        user
      );
      setMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setWalletCreating(false);
    }
  }

  async function confirmWalletOrder() {
    if (!walletCheckout) return;
    const rid = newRechargeDebugRequestId();
    appendRechargeDebug(
      "sim_wallet_complete_start",
      { checkout_id_tail: String(walletCheckout.checkout_id).slice(-12) },
      rid,
      user
    );
    setWalletPaying(true);
    setMsg("");
    try {
      const res = await fetch("/api/subscription/wallet-checkout/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": rid, ...getAuthHeaders() },
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
      appendRechargeDebug(
        "sim_wallet_complete_ok",
        {
          http_status: res.status,
          wallet_balance_cents: typeof data.wallet_balance_cents === "number" ? data.wallet_balance_cents : null
        },
        rid,
        user
      );
      setMsg("余额已入账");
      setWalletCheckout(null);
      await loadMe();
      await refreshMe();
      setRechargeModalOpen(false);
    } catch (err) {
      appendRechargeDebug(
        "sim_wallet_complete_error",
        { message: String(err instanceof Error ? err.message : err) },
        rid,
        user
      );
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
    const rid = newRechargeDebugRequestId();
    appendRechargeDebug(
      "alipay_recharge_start",
      {
        amount_cents: parsed.cents,
        wallet_balance_cents_before: typeof walletBalanceCents === "number" ? walletBalanceCents : null
      },
      rid,
      user
    );
    setAlipayWalletLoading(true);
    setMsg("正在连接支付宝…页面打开后请用手机扫码完成充值。");
    setWalletCheckout(null);
    try {
      const res = await fetch("/api/subscription/recharge", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": rid, ...getAuthHeaders() },
        body: JSON.stringify({ amount_cents: parsed.cents }),
        credentials: "same-origin",
        signal: wac.signal
      });
      const text = await res.text();
      appendRechargeDebug(
        "alipay_recharge_http",
        {
          http_status: res.status,
          body_len: text.length,
          body_preview: text.slice(0, 400).replace(/\s+/g, " ")
        },
        rid,
        user
      );
      const data = (() => {
        try {
          return JSON.parse(text) as {
            success?: boolean;
            pay_page_url?: string;
            out_trade_no?: string;
            amount_cents?: number;
            error?: string;
            detail?: string;
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
      appendRechargeDebug(
        "alipay_recharge_order_ok",
        {
          http_status: res.status,
          pay_url_summary: summarizePayUrl(payUrl),
          out_trade_no_suffix: String(data.out_trade_no).slice(-14),
          amount_cents: data.amount_cents ?? parsed.cents
        },
        rid,
        user
      );
      try {
        const payload: WalletAlipayPendingPayload = {
          startedAt: Date.now(),
          balanceBeforeCents: typeof walletBalanceCents === "number" ? walletBalanceCents : null,
          rechargeCountBefore: rechargeRecords.length,
          outTradeNo: String(data.out_trade_no || "").trim() || undefined
        };
        sessionStorage.setItem(WALLET_ALIPAY_PENDING_KEY, JSON.stringify(payload));
      } catch {
        /* 隐私模式等可能不可用，仍跳转支付 */
      }
      try {
        window.location.assign(payUrl);
      } catch (navErr) {
        throw new Error(
          navErr instanceof Error ? navErr.message : "无法跳转到支付宝收银台，请检查浏览器是否拦截了跳转。"
        );
      }
      appendRechargeDebug("alipay_recharge_navigate_assign", { pay_url_summary: summarizePayUrl(payUrl) }, rid, user);
      didNavigateWallet = true;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      appendRechargeDebug(
        "alipay_recharge_error",
        { name: name || "unknown", message: String(err instanceof Error ? err.message : err) },
        rid,
        user
      );
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
        {rechargeDebugUiReady && rechargePathLogVisibleForUser(user) ? (
          <div className="mb-5 rounded-lg border border-line bg-canvas/60 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-ink">支付宝充值路径日志</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  最近多条记录（可与网关/编排器日志中的 <span className="font-mono">x-request-id</span> 对齐）。管理员账号默认可见；其它用户可设{" "}
                  <span className="font-mono">NEXT_PUBLIC_RECHARGE_DEBUG_UI=1</span> 或{" "}
                  <span className="font-mono">localStorage.recharge_debug_ui=1</span> 后刷新。
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill"
                  onClick={() => {
                    clearRechargeDebug();
                    setRechargeDebugLog([]);
                  }}
                >
                  清空
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(rechargeDebugLog, null, 2));
                      setMsg("充值路径日志已复制到剪贴板。");
                    } catch {
                      setMsg("复制失败，请手动选择下方文字复制。");
                    }
                  }}
                >
                  复制全部
                </button>
              </div>
            </div>
            <ul className="mt-2 max-h-56 list-none space-y-2 overflow-y-auto border-t border-line/60 pt-2 pl-0">
              {rechargePathLogEntries.length === 0 ? (
                <li className="text-[10px] text-muted">暂无相关记录；完成一次「立即支付」或返回本页同步后将出现多条步骤。</li>
              ) : (
                rechargePathLogEntries.map((e, idx) => {
                  const dataStr = e.data ? JSON.stringify(e.data) : "";
                  const dataShort = dataStr.length > 220 ? `${dataStr.slice(0, 220)}…` : dataStr;
                  return (
                    <li
                      key={`${e.ts}_${idx}_${e.step}`}
                      className="border-b border-line/40 pb-2 text-[10px] leading-snug last:border-b-0 last:pb-0"
                    >
                      <div className="font-mono text-[9px] text-muted">{e.ts}</div>
                      <div className="mt-0.5 font-medium text-ink">
                        {e.step}
                        {e.requestId ? (
                          <span className="ml-1 font-mono text-[9px] font-normal text-muted">rid={e.requestId}</span>
                        ) : null}
                      </div>
                      {dataShort ? (
                        <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-[9px] text-ink/85">
                          {dataShort}
                        </pre>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ) : null}
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
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">消费记录</h2>
            {consumptionFilteredTotalCents != null ? (
              <p className="text-xs text-muted">
                筛选时段成功消费合计（钱包扣款）
                <span className="ml-1 font-mono tabular-nums text-ink">{fmtMoneyYuan(consumptionFilteredTotalCents)}</span>
              </p>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-0.5 text-xs text-muted">
              开始日期
              <input
                type="date"
                className="rounded-md border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink"
                value={consumptionSince}
                onChange={(e) => setConsumptionSince(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted">
              结束日期
              <input
                type="date"
                className="rounded-md border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink"
                value={consumptionUntil}
                onChange={(e) => setConsumptionUntil(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
              onClick={() => void loadMe()}
            >
              应用筛选
            </button>
            <button
              type="button"
              className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs text-muted hover:bg-fill"
              onClick={() => {
                setConsumptionSince("");
                setConsumptionUntil("");
                void loadMe("", "");
              }}
            >
              清除
            </button>
          </div>
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
            <>
              <p className="text-xs text-muted">
                点击下方按钮将跳转至支付宝收银台；请使用手机支付宝扫码完成付款。支付完成后返回订阅页即可看到更新后的余额。
              </p>
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
              </div>
            </>
          ) : showSimulatedWalletTopup ? (
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
              <button
                type="button"
                className="w-fit rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:bg-cta/90 disabled:opacity-50"
                disabled={walletCreating || walletPaying || alipayWalletLoading || !walletPayEnabled}
                onClick={() => void createWalletOrder()}
              >
                {walletCreating ? "创建订单中…" : allowMockWallet ? "去支付（内测模拟）" : "创建订单并确认支付入账"}
              </button>
              {!allowMockWallet ? (
                <p className="text-[11px] leading-relaxed text-muted">
                  当前未检测到支付宝通道，使用站内模拟收银完成入账。生产环境开通支付宝后，此处将自动切换为跳转支付宝。
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-warning-ink" role="alert">
              余额充值暂不可用：请在服务端配置 ALIPAY_* 并启用支付宝，或开启模拟收银（SIMULATED_WALLET_CHECKOUT_ENABLED，默认开启）。
            </p>
          )}
          {!walletPayEnabled ? (
            <p className="mt-3 text-xs text-muted">请登录后即可充值账户余额。</p>
          ) : null}
          {walletCheckout && showSimulatedWalletTopup ? (
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
                {walletPaying ? "处理中…" : allowMockWallet ? "确认支付（模拟成功）" : "确认支付并入账"}
              </button>
            </div>
          ) : null}
          {alipayRechargeUiEnabled || showSimulatedWalletTopup ? (
            <div className="mt-6 border-t border-line/80 pt-4">
              <WalletUsageReference refData={mergedWalletTopup.usage_reference} />
            </div>
          ) : null}
          {subscriptionPlansDebugEnabled() && plansLoadDiag ? (
            <div className="mt-4 border-t border-dashed border-line/80 pt-3">
              <p className="mb-2 text-[11px] font-medium text-muted">调试：最近一次 GET /api/subscription/plans（需 build 时含 NEXT_PUBLIC_SUBSCRIPTION_PLANS_DEBUG=1）</p>
              <pre
                className="max-h-52 overflow-auto rounded-lg border border-line bg-canvas p-2 text-left font-mono text-[10px] leading-snug text-muted"
                aria-label="订阅价目拉取诊断"
              >
                {JSON.stringify(plansLoadDiag, null, 2)}
              </pre>
            </div>
          ) : null}
        </FormSheetModal>
      ) : null}

      <FaqAccordion />

      {msg ? <p className="mt-4 text-center text-sm text-muted">{msg}</p> : null}
    </main>
  );
}
