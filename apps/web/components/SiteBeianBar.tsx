"use client";

import Link from "next/link";
import { useI18n } from "../lib/I18nContext";

const dot = <span className="select-none text-line/80" aria-hidden>·</span>;

type Props = {
  /** 营销页等：隐私、协议、ICP 同一行 */
  layout?: "default" | "inline";
};

/**
 * 隐私政策、用户协议、工信部 ICP。
 * `inline`：单行排列；`default`：双行（协议一行、备案一行）。
 */
export function SiteBeianBar({ layout = "default" }: Props) {
  const { t } = useI18n();

  const privacy = (
    <Link
      href="/legal/privacy"
      prefetch={false}
      className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
    >
      {t("footer.linkPrivacyPolicy")}
    </Link>
  );
  const terms = (
    <Link
      href="/legal/terms"
      prefetch={false}
      className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
    >
      {t("footer.linkTermsOfService")}
    </Link>
  );
  const icp = (
    <a
      href="https://beian.miit.gov.cn/#/Integrated/index"
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
    >
      京ICP备2026021080号
    </a>
  );
  if (layout === "inline") {
    return (
      <nav
        className="flex w-full flex-nowrap items-center justify-center gap-x-2 overflow-x-auto overflow-y-hidden whitespace-nowrap px-2 pb-0.5 text-center text-[11px] leading-relaxed text-muted sm:text-xs"
        aria-label={t("footer.beianLegalNavLabel")}
      >
        {privacy}
        {dot}
        {terms}
        {dot}
        {icp}
      </nav>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 px-2 text-center text-[11px] leading-relaxed text-muted sm:text-xs">
      <nav
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1"
        aria-label={t("footer.beianLegalNavLabel")}
      >
        {privacy}
        {dot}
        {terms}
      </nav>
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">{icp}</div>
    </div>
  );
}
