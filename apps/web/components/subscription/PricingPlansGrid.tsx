import { BillingToggle } from "./BillingToggle";
import { PricingPlanCard } from "./PricingPlanCard";
import type { PricingPlan } from "./types";

type Props = {
  plans: PricingPlan[];
  cycle: "monthly" | "yearly";
  onCycleChange: (c: "monthly" | "yearly") => void;
  /** 为 true 时不展示月付/年付切换（仅月付产品） */
  hideBillingCycleToggle?: boolean;
  yearlyDiscountPercent?: number;
  currentPlanId: string;
  submittingTier: string | null;
  onSelectPlan: (tier: string) => void;
  /** 支付宝电脑网站支付已就绪时展示入口 */
  alipayPageEnabled?: boolean;
  alipayLoadingTier?: string | null;
  onAlipayPay?: (tier: string) => void;
};

export function PricingPlansGrid({
  plans,
  cycle,
  onCycleChange,
  hideBillingCycleToggle,
  yearlyDiscountPercent,
  currentPlanId,
  submittingTier,
  onSelectPlan,
  alipayPageEnabled,
  alipayLoadingTier,
  onAlipayPay
}: Props) {
  return (
    <div className="mt-10 space-y-8">
      {hideBillingCycleToggle ? null : (
        <BillingToggle cycle={cycle} onChange={onCycleChange} yearlyDiscountPercent={yearlyDiscountPercent} />
      )}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <PricingPlanCard
            key={p.id}
            plan={p}
            cycle={cycle}
            currentPlanId={currentPlanId}
            submittingTier={submittingTier}
            onSelect={onSelectPlan}
            alipayPageEnabled={alipayPageEnabled}
            alipayLoadingTier={alipayLoadingTier}
            onAlipayPay={onAlipayPay}
          />
        ))}
      </div>
    </div>
  );
}
