"use client";

import Link from "next/link";
import { SUBSCRIPTION_WALLET_TOPUP_HASH } from "../../lib/billingShortfall";

type Props = {
  className?: string;
};

/**
 * 钱包不足、需按量付费时的引导：跳转余额与账单页。
 */
export function BillingShortfallLinks({ className }: Props) {
  return (
    <div className={["flex flex-wrap gap-x-4 gap-y-1 text-xs", className || ""].join(" ")}>
      <Link href={`/subscription${SUBSCRIPTION_WALLET_TOPUP_HASH}`} className="font-medium text-brand underline-offset-2 hover:underline">
        去充值余额
      </Link>
      <Link href="/subscription" className="font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
        查看体验包与计费说明
      </Link>
    </div>
  );
}
