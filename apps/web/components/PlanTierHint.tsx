"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/I18nContext";
import { maxNotesForReferencePlan, mayUseAiPolishPlan } from "../lib/noteReferenceLimits";
import { IconSubscriptionCrown } from "./SubscriptionVipLink";

function planDisplayLabel(planRaw: string, lang: "zh" | "en"): string {
  const p = planRaw.trim().toLowerCase();
  if (lang === "en") {
    if (p === "free") return "Free";
    if (p === "payg") return "Pay-as-you-go";
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : "Free";
  }
  const zh: Record<string, string> = {
    free: "Free",
    payg: "按量",
    basic: "Basic",
    pro: "Pro",
    max: "Max"
  };
  return zh[p] ?? (p || "Free");
}

function fillTierTemplate(template: string, label: string, cap: string): string {
  return template.replace(/\{label\}/g, label).replace(/\{cap\}/g, cap);
}

function IconLayers({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function IconLock({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function IconArrowUpRight({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M7 17L17 7M7 7h10v10" />
    </svg>
  );
}

export type PlanTierHintVariant = "notes_ref" | "tts_polish";

/**
 * 套餐敏感能力旁的轻量提示：图标 + 短标签 + tooltip，避免大段文字占位。
 */
export function PlanTierHint({ variant }: { variant: PlanTierHintVariant }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const plan = String(user?.plan || "free");
  const cap = useMemo(() => maxNotesForReferencePlan(plan), [plan]);
  const label = planDisplayLabel(plan, lang);

  if (variant === "tts_polish") {
    if (mayUseAiPolishPlan(plan)) return null;
    const title = t("tierHint.polishMaxOnly");
    return (
      <div
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-dashed border-warning/35 bg-warning/5 px-2 py-1"
        title={title}
        role="note"
      >
        <IconLock className="shrink-0 text-warning-ink" />
        <IconSubscriptionCrown className="h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
        <Link
          href="/subscription"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-brand hover:bg-brand/10"
          aria-label={t("tierHint.viewPlans")}
          title={t("tierHint.viewPlans")}
        >
          <IconArrowUpRight className="text-brand" />
        </Link>
      </div>
    );
  }

  const fullLine = fillTierTemplate(t("tierHint.notesRefBody"), label, String(cap));
  return (
    <div
      className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-line/60 bg-fill/60 px-2 py-1"
      title={fullLine}
      role="note"
    >
      <IconLayers className="shrink-0 text-muted" />
      <span className="text-[10px] font-medium text-ink">{label}</span>
      <span className="text-[10px] text-muted" aria-hidden>
        ·
      </span>
      <span className="text-[10px] tabular-nums text-muted">
        {lang === "zh" ? `${cap} 条` : `${cap}`}
      </span>
      <Link
        href="/subscription"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-brand hover:bg-brand/10"
        aria-label={t("tierHint.viewPlans")}
        title={t("tierHint.viewPlans")}
      >
        <IconArrowUpRight className="text-brand" />
      </Link>
    </div>
  );
}
