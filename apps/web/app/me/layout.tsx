"use client";

import Link from "next/link";
import { Fragment, useMemo } from "react";
import { usePathname } from "next/navigation";
import { ADMIN_ROLE } from "../../lib/appShellLayout";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";

type MeSubNavItem = { href: string; labelKey: string; dividerBefore?: boolean };

export default function MeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = String((user as { role?: string })?.role || "") === ADMIN_ROLE;

  const items = useMemo<MeSubNavItem[]>(() => {
    const core: MeSubNavItem[] = [
      { href: "/me/profile", labelKey: "me.navProfile" },
      { href: "/me/general", labelKey: "me.navGeneral" }
    ];
    if (!isAdmin) return core;
    return [...core, { href: "/admin/hub", labelKey: "nav.console", dividerBefore: true }];
  }, [isAdmin]);

  function subNavActive(href: string): boolean {
    if (href === "/admin/hub") {
      return pathname === "/admin" || pathname.startsWith("/admin/");
    }
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
          {items.map(({ href, labelKey, dividerBefore }) => {
            const on = subNavActive(href);
            const link = (
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
            if (!dividerBefore) return link;
            return (
              <Fragment key={href}>
                <div className="basis-full px-1 py-0.5 md:px-0 md:py-1" role="separator" aria-hidden>
                  <div className="h-px w-full bg-line/90" />
                </div>
                {link}
              </Fragment>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
