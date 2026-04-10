"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/I18nContext";

const STORAGE_KEY = "fym_onboarding_v1_seen";

export default function OnboardingModal() {
  const { t } = useI18n();
  const { user, ready } = useAuth();
  const isAdmin = ready && String((user as { role?: string })?.role || "") === "admin";
  const [open, setOpen] = useState(false);

  const steps = useMemo(
    () => [
      {
        n: 1,
        title: t("onboarding.step1Title"),
        body: t("onboarding.step1Body"),
        href: "/notes",
        cta: t("onboarding.step1Cta")
      },
      {
        n: 2,
        title: t("onboarding.step2Title"),
        body: t("onboarding.step2Body"),
        href: "/create",
        cta: t("onboarding.step2Cta")
      },
      {
        n: 3,
        title: t("onboarding.step3Title"),
        body: t("onboarding.step3Body"),
        href: "/works",
        cta: t("onboarding.step3Cta")
      }
    ],
    [t]
  );

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-modal">
        <h2 id="onb-title" className="text-lg font-semibold text-ink">
          {t("onboarding.title")}
        </h2>
        <p className="mt-2 text-sm text-muted">{t("onboarding.intro")}</p>
        <ol className="mt-5 space-y-4">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3 rounded-xl border border-line bg-fill/40 p-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand"
                aria-hidden
              >
                {s.n}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{s.body}</p>
                <Link
                  href={s.href}
                  className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
                  onClick={dismiss}
                >
                  {s.cta} →
                </Link>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted">
          {t("onboarding.footer")}
          {isAdmin ? <> {t("onboarding.footerAdmin")}</> : null}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-sm font-medium text-brand-foreground hover:bg-brand min-[400px]:flex-none"
            onClick={dismiss}
          >
            {t("onboarding.dismiss")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:bg-fill"
            onClick={dismiss}
          >
            {t("onboarding.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
