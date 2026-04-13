"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";

export type ThemeMode = "dark" | "light";

const KEY = "fym_theme";

function applyThemeClass(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
}

export function readThemeFromStorage(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark") return "dark";
  } catch {
    // ignore
  }
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /** 首帧必须与 SSR 一致，切勿在 useState 初始值里读 localStorage，否则会 hydration failed → 白屏 */
  const [theme, setThemeState] = useState<ThemeMode>("light");

  useLayoutEffect(() => {
    const mode = readThemeFromStorage();
    setThemeState(mode);
    applyThemeClass(mode);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // ignore
    }
    applyThemeClass(mode);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

type ThemeCtx = {
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
