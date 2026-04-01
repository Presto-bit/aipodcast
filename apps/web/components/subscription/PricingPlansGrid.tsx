import { BillingToggle } from "./BillingToggle";
import { PricingPlanCard } from "./PricingPlanCard";
import type { PricingPlan } from "./types";

type Props = {
  plans: PricingPlan[];
  cycle: "monthly" | "yearly";
  onCycleChange: (c: "monthly" | "yearly") => void;
  yearlyDiscountPercent?: number;
  currentPlanId: string;
  submittingTier: string | null;
  onSelectPlan: (tier: string) => void;
  /** 微信 Native 已就绪时展示扫码支付入口 */
  wechatNativeEnabled?: boolean;
  wechatLoadingTier?: string | null;
  onWechatPay?: (tier: string) => void;
};

export function PricingPlansGrid({
  plans,
  cycle,
  onCycleChange,
  yearlyDiscountPercent,
  currentPlanId,
  submittingTier,
  onSelectPlan,
  wechatNativeEnabled,
  wechatLoadingTier,
  onWechatPay
}: Props) {
  return (
    <div className="mt-10 space-y-8">
      <BillingToggle cycle={cycle} onChange={onCycleChange} yearlyDiscountPercent={yearlyDiscountPercent} />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <PricingPlanCard
            key={p.id}
            plan={p}
            cycle={cycle}
            currentPlanId={currentPlanId}
            submittingTier={submittingTier}
            onSelect={onSelectPlan}
            wechatNativeEnabled={wechatNativeEnabled}
            wechatLoadingTier={wechatLoadingTier}
            onWechatPay={onWechatPay}
          />
        ))}
      </div>
    </div>
  );
}
