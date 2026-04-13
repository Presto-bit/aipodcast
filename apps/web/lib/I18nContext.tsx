"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { I18N_DICT, type Lang } from "./i18nDict";

const KEY = "fym_lang";

export function readLangFromStorage(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    // ignore
  }
  return "zh";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  /** 首帧固定 zh，与 SSR 一致；客户端再在 layout effect 里同步 localStorage */
  const [lang, setLangState] = useState<Lang>("zh");

  useLayoutEffect(() => {
    setLangState(readLangFromStorage());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // ignore
    }
    document.documentElement.lang = l === "en" ? "en" : "zh-CN";
  }, []);

  const t = useCallback((key: string) => {
    const dict = I18N_DICT[lang] ?? I18N_DICT.zh;
    return dict[key] ?? I18N_DICT.zh[key] ?? key;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nCtx | null>(null);

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
