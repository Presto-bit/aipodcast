"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/I18nContext";
import { maxNotesForReferencePlan, mayUseAiPolishPlan } from "../lib/noteReferenceLimits";

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

export type PlanTierHintVariant = "notes_ref" | "tts_polish";

/**
 * 在套餐敏感能力旁提示当前档位与权益，并链到订阅页。
 */
export function PlanTierHint({ variant }: { variant: PlanTierHintVariant }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const plan = String(user?.plan || "free");
  const cap = useMemo(() => maxNotesForReferencePlan(plan), [plan]);
  const label = planDisplayLabel(plan, lang);

  if (variant === "tts_polish") {
    if (mayUseAiPolishPlan(plan)) return null;
    return (
      <p className="mt-1 text-[11px] leading-snug text-muted">
        {t("tierHint.polishMaxOnly")}{" "}
        <Link href="/subscription" className="font-medium text-brand hover:underline">
          {t("tierHint.viewPlans")}
        </Link>
      </p>
    );
  }

  const body = fillTierTemplate(t("tierHint.notesRefBody"), label, String(cap));
  return (
    <p className="mt-1 text-[11px] leading-snug text-muted">
      {body}{" "}
      <Link href="/subscription" className="font-medium text-brand hover:underline">
        {t("tierHint.viewPlans")}
      </Link>
    </p>
  );
}
