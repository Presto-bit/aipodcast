"use client";

import { useMemo } from "react";
import { describePostAuthReturnTo } from "../../lib/authReturnToContext";

type Variant = "login" | "register";

export default function AuthReturnToContextBanner({
  returnTo,
  variant
}: {
  returnTo: string | null;
  variant: Variant;
}) {
  const ctx = useMemo(() => describePostAuthReturnTo(returnTo), [returnTo]);
  if (!ctx) return null;

  const afterAuth = variant === "register" ? "注册成功后" : "登录成功后";

  return (
    <div
      className="mt-4 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2.5 text-sm"
      role="status"
      aria-live="polite"
    >
      <p className="font-medium text-ink">{ctx.headline}</p>
      <p className="mt-1 leading-relaxed text-muted">
        {afterAuth}
        {ctx.detail}
      </p>
    </div>
  );
}
