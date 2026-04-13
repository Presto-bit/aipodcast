import type { ReactNode } from "react";
import type { PricingPlan } from "./types";

function fmtYuan(cents?: number | null) {
  if (cents == null || typeof cents !== "number") return "待定";
  if (cents === 0) return "¥0";
  return `¥${(cents / 100).toFixed(2)}`;
}

type Props = {
  plan: PricingPlan;
  cycle: "monthly" | "yearly";
  currentPlanId: string;
  submittingTier: string | null;
  ctaLabel?: string;
  /** 管理员页：自定义主按钮文案 */
  primaryAction?: "select" | "custom";
  customButton?: ReactNode;
  onSelect?: (tier: string) => void;
  alipayPageEnabled?: boolean;
  alipayLoadingTier?: string | null;
  onAlipayPay?: (tier: string) => void;
  /** 已登录真实账号时展示「余额支付月费」 */
  walletPayEnabled?: boolean;
  walletPayBusyTier?: string | null;
  onWalletPay?: (tier: string) => void;
};

export function PricingPlanCard({
  plan,
  cycle,
  currentPlanId,
  submittingTier,
  ctaLabel,
  primaryAction = "select",
  customButton,
  onSelect,
  alipayPageEnabled,
  alipayLoadingTier,
  onAlipayPay,
  walletPayEnabled,
  walletPayBusyTier,
  onWalletPay
}: Props) {
  const p = plan;
  const monthly = p.monthly_price_cents ?? null;
  const yearly = p.yearly_price_cents ?? null;
  const equiv = p.yearly_equivalent_monthly_cents ?? (yearly ? Math.floor(yearly / 12) : 0);
  const isFree = p.id === "free";
  const isCurrent = currentPlanId === p.id;
  const popular = p.badge === "popular";
  const starter = p.badge === "starter";
  const isSubmittingThis = submittingTier === p.id;
  const anySubmitting = submittingTier != null && submittingTier !== "";
  const alipayLoadingThis = alipayLoadingTier === p.id;
  const alipayBusy = alipayLoadingTier != null && alipayLoadingTier !== "";
  const walletBusyThis = walletPayBusyTier === p.id;
  const walletBusy = walletPayBusyTier != null && walletPayBusyTier !== "";
  /** 已接支付宝时：主按钮走真实收银台，避免用户只点「订阅」却仅保存意向 */
  const primaryAlipay = !isFree && Boolean(alipayPageEnabled && onAlipayPay);

  const showYearly = cycle === "yearly" && !isFree && yearly != null && yearly > 0;
  const displayMainCents = showYearly ? equiv : monthly;
  const strikethroughCents = showYearly && monthly != null && monthly > 0 ? monthly : null;

  const quotas = Array.isArray(p.summary_quotas) ? p.summary_quotas : [];
  const bullets = Array.isArray(p.feature_bullets) ? p.feature_bullets : [];
  const inherits = p.inherits_label;

  return (
    <article
      className={[
        "relative flex h-full flex-col rounded-2xl border bg-surface/70 p-5 shadow-soft transition",
        popular ? "border-brand/50 ring-1 ring-brand/20" : starter ? "border-mint/35 ring-1 ring-mint/15" : "border-line"
      ].join(" ")}
    >
      {popular ? (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-foreground">
          最受欢迎
        </span>
      ) : null}
      {starter && !popular ? (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-mint/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mint-foreground">
          入门
        </span>
      ) : null}

      <h2 className="text-lg font-semibold text-ink">{p.name || p.id}</h2>
      {p.description ? <p className="mt-1 text-xs text-muted">{p.description}</p> : null}

      <div className="mt-4 min-h-[4.5rem]">
        {isFree ? (
          <p className="text-3xl font-bold text-ink">{fmtYuan(0)}</p>
        ) : showYearly ? (
          <div className="flex flex-wrap items-end gap-2">
            {strikethroughCents != null ? (
              <span className="text-lg text-muted line-through">{fmtYuan(strikethroughCents)}</span>
            ) : null}
            <span className="text-3xl font-bold text-ink">{fmtYuan(displayMainCents)}</span>
            <span className="pb-1 text-sm text-muted">/月</span>
          </div>
        ) : (
          <p className="text-3xl font-bold text-ink">
            {fmtYuan(monthly)}
            <span className="ml-1 text-base font-normal text-muted">/月</span>
          </p>
        )}
        {!isFree && yearly != null && yearly > 0 ? (
          <p className="mt-1 text-xs text-muted">
            {showYearly ? `按年付费，${fmtYuan(yearly)}/年` : `按年付费 ${fmtYuan(yearly)}/年（约 ${fmtYuan(equiv)}/月）`}
          </p>
        ) : isFree ? (
          <p className="mt-1 text-xs text-muted">基础能力，无需绑卡</p>
        ) : null}
      </div>

      {quotas.length > 0 ? (
        <ul className="mt-4 space-y-1.5 border-t border-line/80 pt-4 text-xs">
          {quotas.map((row) => (
            <li key={row.key} className="flex justify-between gap-2 text-muted">
              <span>{row.label}</span>
              <span className="shrink-0 font-medium text-ink">{row.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex-1 border-t border-line/80 pt-4">
        {inherits ? <p className="text-xs font-medium text-ink">{inherits}</p> : null}
        <ul className="mt-2 list-inside list-disc space-y-1.5 text-xs text-muted">
          {bullets.map((line, i) => (
            <li key={i} className="marker:text-brand/80">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        {primaryAction === "custom" && customButton ? (
          customButton
        ) : primaryAlipay ? (
          <>
            <button
              type="button"
              className="w-full rounded-xl bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground transition hover:bg-cta/90 disabled:opacity-50"
              disabled={anySubmitting || alipayBusy || walletBusy || isCurrent}
              onClick={() => onAlipayPay?.(p.id)}
            >
              {alipayLoadingThis ? "正在跳转支付宝…" : "支付宝扫码支付"}
            </button>
            <button
              type="button"
              className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-2 text-sm font-medium text-muted transition hover:bg-fill disabled:opacity-50"
              disabled={anySubmitting || alipayBusy || walletBusy || isCurrent}
              onClick={() => onSelect?.(p.id)}
            >
              {isSubmittingThis
                ? "处理中…"
                : isCurrent
                  ? "当前方案"
                  : "仅保存意向（不扣款）"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="w-full rounded-xl bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground transition hover:bg-cta/90 disabled:opacity-50"
            disabled={anySubmitting || alipayBusy || walletBusy || isCurrent}
            onClick={() => onSelect?.(p.id)}
          >
            {isSubmittingThis
              ? "处理中…"
              : isCurrent
                ? "当前方案"
                : ctaLabel || (isFree ? "选用 Free" : `订阅 ${p.name || p.id}`)}
          </button>
        )}
        {!isFree && walletPayEnabled && onWalletPay ? (
          <button
            type="button"
            className="mt-2 w-full rounded-xl border border-mint/40 bg-mint/10 px-4 py-2 text-sm font-medium text-mint-foreground transition hover:bg-mint/20 disabled:opacity-50"
            disabled={anySubmitting || alipayBusy || walletBusy || isCurrent}
            onClick={() => onWalletPay(p.id)}
          >
            {walletBusyThis
              ? "扣款中…"
              : `余额支付月费（${fmtYuan(monthly)}）`}
          </button>
        ) : null}
        {!isFree && !primaryAlipay && alipayPageEnabled && onAlipayPay ? (
          <button
            type="button"
            className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill disabled:opacity-50"
            disabled={anySubmitting || alipayBusy || walletBusy || isCurrent}
            onClick={() => onAlipayPay(p.id)}
          >
            {alipayLoadingThis ? "正在创建订单…" : "支付宝扫码支付"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
