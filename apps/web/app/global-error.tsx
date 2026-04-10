"use client";

import { useEffect } from "react";
import "./globals.css";

/** 根布局级错误时必须自带 html/body；此处单独引入 globals 以便 Tailwind 生效 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-canvas text-ink">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
          <div className="fym-surface-card max-w-md px-8 py-10 text-center">
            <h1 className="text-base font-semibold text-ink">应用异常</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {error.message || "发生未捕获错误。请重试或刷新页面。"}
            </p>
            <button
              type="button"
              className="mt-6 w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90"
              onClick={() => reset()}
            >
              重试
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
