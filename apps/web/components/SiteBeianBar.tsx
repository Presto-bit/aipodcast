"use client";

import Link from "next/link";
import { useI18n } from "../lib/I18nContext";

/**
 * 首页底部：隐私政策与用户协议（位于备案号上方），以及工信部 ICP + 公安备案查询。
 */
export function SiteBeianBar() {
  const { t } = useI18n();
  return (
    <div className="flex w-full flex-col items-center gap-2 px-2 text-center text-[11px] leading-relaxed text-muted sm:text-xs">
      <nav
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1"
        aria-label={t("footer.beianLegalNavLabel")}
      >
        <Link
          href="/legal/privacy"
          prefetch={false}
          className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
        >
          {t("footer.linkPrivacyPolicy")}
        </Link>
        <span className="select-none text-line/80" aria-hidden>
          ·
        </span>
        <Link
          href="/legal/terms"
          prefetch={false}
          className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
        >
          {t("footer.linkTermsOfService")}
        </Link>
      </nav>
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <a
          href="https://beian.miit.gov.cn/#/Integrated/index"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
        >
          京ICP备2026021080号
        </a>
        <span className="select-none text-line/80" aria-hidden>
          ·
        </span>
        <a
          href="https://beian.mps.gov.cn/#/query/webSearch"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted underline-offset-2 transition hover:text-ink hover:underline"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0 text-[#0052d9] dark:text-[#4c8dff]"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 2.18L19 6.3v4.7c0 4.52-3.06 8.71-7 9.92-3.94-1.21-7-5.4-7-9.92V6.3l7-3.12Z" />
          </svg>
          <span>公安备案查询</span>
        </a>
      </div>
    </div>
  );
}
