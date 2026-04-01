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
  wechatNativeEnabled?: boolean;
  wechatLoadingTier?: string | null;
  onWechatPay?: (tier: string) => void;
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
  wechatNativeEnabled,
  wechatLoadingTier,
  onWechatPay
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
  const wechatLoadingThis = wechatLoadingTier === p.id;
  const wechatBusy = wechatLoadingTier != null && wechatLoadingTier !== "";

  const showYearly = cycle === "yearly" && !isFree && yearly != null && yearly > 0;
  const displayMainCents = showYearly ? equiv : monthly;
  const strikethroughCents = showYearly && monthly != null && monthly > 0 ? monthly : null;

  const quotas = Array.isArray(p.summary_quotas) ? p.summary_quotas : [];
  const bullets = Array.isArray(p.feature_bullets) ? p.feature_bullets : [];
  const inherits = p.inherits_label;

  return (
    <article
      className={[
        "relative flex h-full flex-col rounded-2xl border bg-surface/70 p-5 shadow-sm transition",
        popular ? "border-brand/50 ring-1 ring-brand/20" : starter ? "border-emerald-500/35 ring-1 ring-emerald-500/15" : "border-line"
      ].join(" ")}
    >
      {popular ? (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          最受欢迎
        </span>
      ) : null}
      {starter && !popular ? (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
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
          <p className="mt-1 text-xs text-muted">按年同样免费</p>
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
        ) : (
          <button
            type="button"
            className="w-full rounded-xl bg-cta px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cta/90 disabled:opacity-50"
            disabled={anySubmitting || wechatBusy || isCurrent}
            onClick={() => onSelect?.(p.id)}
          >
            {isSubmittingThis
              ? "处理中…"
              : isCurrent
                ? "当前方案"
                : ctaLabel || (isFree ? "选用 Free" : `订阅 ${p.name || p.id}`)}
          </button>
        )}
        {!isFree && wechatNativeEnabled && onWechatPay ? (
          <button
            type="button"
            className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill disabled:opacity-50"
            disabled={anySubmitting || wechatBusy || isCurrent}
            onClick={() => onWechatPay(p.id)}
          >
            {wechatLoadingThis ? "正在创建订单…" : "微信扫码支付"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
