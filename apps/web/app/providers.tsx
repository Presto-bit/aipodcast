"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import DeployVersionSync from "../components/DeployVersionSync";
import AppShell from "../components/AppShell";
import { AuthProvider } from "../lib/auth";
import { I18nProvider } from "../lib/I18nContext";
import { ThemeProvider } from "../lib/ThemeContext";
import { WorkAudioPlayerProvider } from "../lib/workAudioPlayer";

const CHUNK_RELOAD_GUARD_KEY = "fym_chunk_reload_guard_v1";

function isChunkLoadFailureMessage(msg: unknown): boolean {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("loading chunk") ||
    s.includes("chunkloaderror") ||
    (s.includes("chunk") && s.includes("failed")) ||
    s.includes("_next/static/chunks")
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true
          }
        }
      })
  );

  useEffect(() => {
    const reloadOnceForChunkFailure = (reason: unknown) => {
      if (!isChunkLoadFailureMessage(reason)) return;
      try {
        const now = Date.now();
        const raw = sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY);
        const prevTs = raw ? Number.parseInt(raw, 10) : 0;
        // 10 秒内仅允许自动重试一次，避免异常循环刷新。
        if (Number.isFinite(prevTs) && prevTs > 0 && now - prevTs < 10_000) return;
        sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
        const url = new URL(window.location.href);
        url.searchParams.set("__chunk_retry", String(now));
        window.location.replace(url.toString());
      } catch {
        // ignore
      }
    };

    const onError = (event: ErrorEvent) => {
      const target = event.target as { src?: string; href?: string } | null;
      const src = String(target?.src || target?.href || "");
      reloadOnceForChunkFailure(event.message || src);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: unknown } | null;
      reloadOnceForChunkFailure(reason?.message || event.reason);
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection, true);
    };
  }, []);

  return (
    <QueryClientProvider client={client}>
      <DeployVersionSync />
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <WorkAudioPlayerProvider>
              <AppShell>{children}</AppShell>
            </WorkAudioPlayerProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
