import type { ReactNode } from "react";
import Link from "next/link";

type LegalDocPageProps = {
  title: string;
  updatedLabel: string;
  children: ReactNode;
};

export function LegalDocPage({ title, updatedLabel, children }: LegalDocPageProps) {
  return (
    <main className="mx-auto min-h-0 max-w-2xl fym-surface-card p-[var(--dawn-space-section)]">
      <div className="mb-6">
        <Link href="/" className="text-sm text-brand hover:text-brand/85">
          ← 返回首页
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-xs text-muted">{updatedLabel}</p>
      <article className="mt-8 space-y-8 text-sm leading-relaxed text-ink">{children}</article>
    </main>
  );
}
