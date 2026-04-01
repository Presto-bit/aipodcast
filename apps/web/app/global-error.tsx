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
      <body className="bg-fill text-ink">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
          <h1 className="text-lg font-semibold">应用出错</h1>
          <p className="max-w-md text-center text-sm text-muted">
            {error.message || "根级错误，请重试或刷新页面。"}
          </p>
          <button
            type="button"
            className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand"
            onClick={() => reset()}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
