"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "../../lib/I18nContext";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-8 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  const { t } = useI18n();

  return (
    <main className="mx-auto min-h-0 max-w-2xl fym-surface-card p-[var(--dawn-space-section)]">
      <div className="mb-6">
        <Link href="/" className="text-sm text-brand hover:text-brand/85">
          ← {t("nav.home")}
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("help.title")}</h1>
      <p className="mt-3 text-sm text-muted">{t("help.intro")}</p>

      <div className="mt-8 space-y-0">
        <Section id="docs" title={t("help.docsTitle")}>
          <p>{t("help.docsBody")}</p>
        </Section>
        <Section id="status" title={t("help.statusTitle")}>
          <p>{t("help.statusBody")}</p>
        </Section>
        <Section id="legal" title={t("help.legalTitle")}>
          <p>{t("help.legalBody")}</p>
        </Section>
      </div>
    </main>
  );
}
