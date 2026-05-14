"use client";

import Link from "next/link";
import { useI18n } from "../lib/I18nContext";

const dot = <span className="select-none text-line/80" aria-hidden>·</span>;

const beianIcon = (
  <svg
    className="h-3.5 w-3.5 shrink-0 text-[#0052d9] dark:text-[#4c8dff]"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
  >
    <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 2.18L19 6.3v4.7c0 4.52-3.06 8.71-7 9.92-3.94-1.21-7-5.4-7-9.92V6.3l7-3.12Z" />
  </svg>
);

type Props = {
  /** 营销页等：隐私、协议、ICP、公安同一行 */
  layout?: "default" | "inline";
};

/**
 * 隐私政策、用户协议、工信部 ICP、公安备案查询。
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
  const police = (
    <a
      href="https://beian.mps.gov.cn/#/query/webSearch"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-muted underline-offset-2 transition hover:text-ink hover:underline"
    >
      {beianIcon}
      <span>公安备案查询</span>
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
        {dot}
        {police}
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
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {icp}
        {dot}
        {police}
      </div>
    </div>
  );
}
