"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 原「我的订阅」入口已合并到「余额与账单」页。 */
export default function MeSubscriptionRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/subscription#wallet-topup");
  }, [router]);
  return (
    <p className="py-10 text-center text-sm text-muted" role="status">
      正在跳转到余额与账单…
    </p>
  );
}
