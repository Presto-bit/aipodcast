"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../../lib/I18nContext";

export default function MeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const { t } = useI18n();

  const items: { href: string; labelKey: string }[] = [
    { href: "/me/profile", labelKey: "me.navProfile" },
    { href: "/me/subscription", labelKey: "me.navSubscription" },
    { href: "/me/general", labelKey: "me.navGeneral" }
  ];

  function subNavActive(href: string): boolean {
    if (href === "/me/profile") {
      return pathname === "/me/profile" || pathname === "/me" || pathname === "/me/";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-10 sm:px-4">
      <header className="mb-6 text-center md:text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("me.pageTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{t("me.pageSubtitle")}</p>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav
          className="flex shrink-0 flex-row flex-wrap gap-1 rounded-xl border border-line bg-surface/80 p-1 md:w-44 md:flex-col md:flex-nowrap"
          aria-label="我的 — 子导航"
        >
          {items.map(({ href, labelKey }) => {
            const on = subNavActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "rounded-lg px-3 py-2 text-sm transition-colors md:w-full",
                  on ? "bg-brand/15 font-medium text-ink ring-1 ring-brand/25" : "text-muted hover:bg-fill hover:text-ink"
                ].join(" ")}
              >
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
