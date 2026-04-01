"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import AppShell from "../components/AppShell";
import { AuthProvider } from "../lib/auth";
import { I18nProvider } from "../lib/I18nContext";
import { ThemeProvider } from "../lib/ThemeContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 3000,
            refetchOnWindowFocus: false
          }
        }
      })
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
