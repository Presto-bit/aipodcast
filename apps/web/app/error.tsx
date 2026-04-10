"use client";

import { useEffect, useMemo } from "react";
import { classifyErrorTone, errorPageCopy } from "../lib/errorCopy";
import { useI18n } from "../lib/I18nContext";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const { headline, sub } = useMemo(
    () => errorPageCopy(classifyErrorTone(error.message), t),
    [error.message, t]
  );
  const digest = error.digest;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-ink">
      <div className="fym-surface-card w-full max-w-md px-8 py-10 text-center">
        <h1 className="text-base font-semibold">{headline}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{sub}</p>
        {error.message ? (
          <p className="mt-4 max-h-32 max-w-full overflow-y-auto break-words rounded-dawn-md border border-line bg-fill/50 px-3 py-2 text-left font-mono text-xs text-muted">
            {error.message}
          </p>
        ) : null}
        {digest ? (
          <p className="mt-4 text-xs text-muted">
            <span className="font-mono tabular-nums text-ink">{digest}</span>
            <span className="mt-1 block">{t("error.digestHint")}</span>
          </p>
        ) : null}
        <button
          type="button"
          className="mt-6 w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90"
          onClick={() => reset()}
        >
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}
