"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { messageSuggestsBillingTopUpOrSubscription, SUBSCRIPTION_WALLET_TOPUP_HASH } from "./billingShortfall";
import { toUserFacingError } from "./userFacingError";

type Notice = { kind: "error" | "info"; message: string } | null;

type AppNoticeApi = {
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  dismiss: () => void;
};

const AppNoticeContext = createContext<AppNoticeApi | null>(null);

export function AppNoticeProvider({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<Notice>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNotice(null);
  }, []);

  const push = useCallback(
    (kind: "error" | "info", message: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setNotice({ kind, message });
      const ms = kind === "error" ? 10_000 : 5000;
      timerRef.current = setTimeout(() => {
        setNotice(null);
        timerRef.current = null;
      }, ms);
    },
    []
  );

  const showError = useCallback((m: string) => push("error", m), [push]);
  const showInfo = useCallback((m: string) => push("info", m), [push]);

  const value = useMemo(() => ({ showError, showInfo, dismiss }), [showError, showInfo, dismiss]);

  const parsed = notice ? toUserFacingError(notice.message) : null;
  const billing = notice?.kind === "error" && messageSuggestsBillingTopUpOrSubscription(notice.message);
  const showTechnicalExpand =
    notice?.kind === "error" && parsed?.technical && parsed.technical !== parsed.headline;

  return (
    <AppNoticeContext.Provider value={value}>
      {children}
      {notice && parsed ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[2000] flex justify-center p-4 sm:bottom-2"
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live={notice.kind === "error" ? "assertive" : "polite"}
        >
          <div
            className={[
              "pointer-events-auto max-w-lg min-w-0 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm",
              notice.kind === "error"
                ? "border-danger-ink/30 bg-danger-soft/90 text-danger-ink"
                : "border-line bg-surface/95 text-ink"
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm leading-relaxed">{parsed.headline}</p>
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-0.5 text-xs opacity-80 hover:opacity-100"
                onClick={dismiss}
              >
                关闭
              </button>
            </div>
            {parsed.requestId && notice.kind === "error" ? (
              <p className="mt-1.5 font-mono text-[11px] opacity-90">请求编号：{parsed.requestId}</p>
            ) : null}
            {showTechnicalExpand ? (
              <details className="mt-2 text-[11px] leading-relaxed opacity-95">
                <summary className="cursor-pointer select-none text-ink underline-offset-2 hover:underline">
                  查看完整诊断信息
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface/85 p-2 text-muted">
                  {parsed.technical}
                </pre>
                <button
                  type="button"
                  className="mt-1 text-ink underline-offset-2 hover:underline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(parsed?.technical || notice.message);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  复制完整信息
                </button>
              </details>
            ) : null}
            {billing ? (
              <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
                <Link href={`/subscription${SUBSCRIPTION_WALLET_TOPUP_HASH}`} className="font-medium underline-offset-2 hover:underline">
                  去充值
                </Link>
                <Link href="/subscription" className="text-muted underline-offset-2 hover:text-ink hover:underline">
                  查看计费说明
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppNoticeContext.Provider>
  );
}

export function useAppNotice(): AppNoticeApi {
  const ctx = useContext(AppNoticeContext);
  if (!ctx) {
    return {
      showError: (m: string) => {
        if (typeof window !== "undefined") window.alert(m);
      },
      showInfo: (m: string) => {
        if (typeof window !== "undefined") window.alert(m);
      },
      dismiss: () => {}
    };
  }
  return ctx;
}
