"use client";

import { useMemo, useState } from "react";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { toUserFacingError } from "../../lib/userFacingError";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";

type Props = {
  message: string;
  onDismiss?: () => void;
  className?: string;
  /** 对话区等紧凑布局 */
  variant?: "default" | "dense";
};

/**
 * 统一错误展示：短主文案、可选折叠技术详情、额度不足时附充值入口。
 */
export default function UserErrorBanner({ message, onDismiss, className, variant = "default" }: Props) {
  const parts = useMemo(() => toUserFacingError(message), [message]);
  const showBilling =
    messageSuggestsBillingTopUpOrSubscription(message) || messageSuggestsBillingTopUpOrSubscription(parts.headline);
  const [copied, setCopied] = useState(false);
  const pad = variant === "dense" ? "p-2.5" : "p-3";
  const textSize = variant === "dense" ? "text-xs" : "text-sm";

  async function copyFull() {
    const payload = parts.technical || message;
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyId() {
    if (!parts.requestId) return;
    try {
      await navigator.clipboard.writeText(parts.requestId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={[
        "rounded-xl border border-danger-ink/25 bg-danger-soft/35 text-danger-ink shadow-sm",
        pad,
        textSize,
        className || ""
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 leading-relaxed">{parts.headline}</p>
        {onDismiss ? (
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-danger-ink underline-offset-2 hover:underline"
            onClick={onDismiss}
          >
            关闭
          </button>
        ) : null}
      </div>

      {parts.requestId ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] opacity-90">
          <span className="font-mono">请求编号：{parts.requestId}</span>
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => void copyId()}>
            复制编号
          </button>
        </div>
      ) : null}

      {parts.technical && parts.technical !== parts.headline ? (
        <details className="mt-2 text-[11px] leading-relaxed opacity-95">
          <summary className="cursor-pointer select-none text-ink underline-offset-2 hover:underline">查看完整诊断信息</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface/80 p-2 text-muted">
            {parts.technical}
          </pre>
          <button
            type="button"
            className="mt-1 underline-offset-2 hover:underline"
            onClick={() => void copyFull()}
          >
            {copied ? "已复制到剪贴板" : "复制完整信息"}
          </button>
        </details>
      ) : null}

      {showBilling ? <BillingShortfallLinks className="mt-2" /> : null}
    </div>
  );
}
