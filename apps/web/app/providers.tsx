"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import DeployVersionSync from "../components/DeployVersionSync";
import AppShell from "../components/AppShell";
import { AuthProvider } from "../lib/auth";
import { I18nProvider } from "../lib/I18nContext";
import { ThemeProvider } from "../lib/ThemeContext";
import { WorkAudioPlayerProvider } from "../lib/workAudioPlayer";

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
