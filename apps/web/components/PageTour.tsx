"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../lib/I18nContext";
import { globalOnboardingSteps } from "../lib/pageTourContent";
import { readLocalStorageScoped, writeLocalStorageScoped } from "../lib/userScopedStorage";

/** 全局分步新手指引完成标记（全站仅一次） */
const STORAGE_SEEN = "fym_onboarding_steps_v1_seen";
/** 旧版一次性弹窗 */
const LEGACY_ONBOARDING = "fym_onboarding_v1_seen";
/** 已废弃：按页 tour 的完成记录；存在则视为已看过引导，避免重复打扰 */
const LEGACY_PAGE_TOUR = "fym_page_tour_done_v1";

function hasCompletedOnboarding(): boolean {
  try {
    if (typeof window === "undefined") return true;
    if (readLocalStorageScoped(STORAGE_SEEN) === "1") return true;
    if (window.localStorage.getItem(LEGACY_ONBOARDING) === "1") return true;
    const pageTour = window.localStorage.getItem(LEGACY_PAGE_TOUR);
    if (pageTour && pageTour !== "{}" && pageTour !== "null") {
      try {
        const o = JSON.parse(pageTour) as Record<string, boolean>;
        if (o && typeof o === "object" && Object.keys(o).length > 0) return true;
      } catch {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function markOnboardingSeen() {
  try {
    writeLocalStorageScoped(STORAGE_SEEN, "1");
  } catch {
    // ignore
  }
}

/**
 * 全局分步新手指引：下一步 / 跳过，默认整站只展示一次（localStorage）。
 * 不再按路由重复展示。
 */
export default function PageTour() {
  const { t, lang } = useI18n();
  const steps = useMemo(() => globalOnboardingSteps(lang), [lang]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setOpen(!hasCompletedOnboarding());
    setStep(0);
  }, [hydrated]);

  const finish = useCallback(() => {
    markOnboardingSeen();
    setOpen(false);
  }, []);

  const onNext = useCallback(() => {
    if (step >= steps.length - 1) {
      finish();
      return;
    }
    setStep((s) => s + 1);
  }, [step, steps.length, finish]);

  const onSkip = useCallback(() => {
    finish();
  }, [finish]);

  if (!open || steps.length === 0) return null;

  const current = steps[step];
  if (!current) return null;

  const progress = `${step + 1}/${steps.length}`;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-end justify-center bg-black/35 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-tour-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-modal">
        <p className="text-xs font-medium text-muted">{progress}</p>
        <h2 id="page-tour-title" className="mt-1 text-lg font-semibold text-ink">
          {current.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{current.body}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-sm font-medium text-brand-foreground hover:bg-brand min-[360px]:flex-none"
            onClick={onNext}
          >
            {step >= steps.length - 1 ? t("pageTour.done") : t("pageTour.next")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:bg-fill"
            onClick={onSkip}
          >
            {t("pageTour.skip")}
          </button>
        </div>
      </div>
    </div>
  );
}
