"use client";

import Link from "next/link";
import { useI18n } from "../lib/I18nContext";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-12">
      <div className="fym-surface-card w-full max-w-md px-8 py-10 text-center">
        <p className="font-mono text-3xl font-semibold tabular-nums text-muted">404</p>
        <h1 className="mt-3 text-base font-semibold text-ink">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("notFound.desc")}</p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90"
        >
          {t("notFound.cta")}
        </Link>
      </div>
    </div>
  );
}
