"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../lib/I18nContext";
import { stepsForTour } from "../lib/pageTourContent";
import { tourIdForPathname } from "../lib/pageTourRoutes";

const STORAGE_KEY = "fym_page_tour_done_v1";

function readDoneMap(): Record<string, boolean> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeDone(tourId: string) {
  try {
    const next = { ...readDoneMap(), [tourId]: true };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/**
 * 按路由展示分步新手指引；每个 tourId 默认只完成一次（localStorage）。
 * 与旧版全局弹窗 `fym_onboarding_v1_seen` 独立；不再渲染 OnboardingModal。
 */
export default function PageTour() {
  const pathname = usePathname() || "/";
  const { t, lang } = useI18n();
  const tourId = useMemo(() => tourIdForPathname(pathname), [pathname]);
  const steps = useMemo(() => (tourId ? stepsForTour(tourId, lang) : []), [tourId, lang]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setStep(0);
  }, [tourId]);

  useEffect(() => {
    if (!hydrated || !tourId || steps.length === 0) {
      setOpen(false);
      return;
    }
    const done = readDoneMap()[tourId];
    setOpen(!done);
  }, [hydrated, tourId, steps.length]);

  const finish = useCallback(() => {
    if (tourId) writeDone(tourId);
    setOpen(false);
  }, [tourId]);

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
