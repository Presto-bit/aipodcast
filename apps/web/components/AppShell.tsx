"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  IconAdmin,
  IconDraft,
  IconGrid,
  IconHome,
  IconMic,
  IconNotes,
  IconSearch,
  IconSubscription,
  IconUser,
  IconTemplate,
  IconTrash,
  IconTts,
  IconVoice
} from "./NavIcons";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/I18nContext";
import OnboardingModal from "./OnboardingModal";
import BrandGlyph from "./brand/BrandGlyph";

const COLLAPSE_KEY = "fym_web_sidebar_collapsed";

type NavItem = {
  href: string;
  label: string;
  short?: string;
  Icon: ComponentType<object>;
  /** 自定义高亮（例如子路由需与父入口同时高亮） */
  activeMatch?: (pathname: string) => boolean;
};

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
    </svg>
  );
}

function navButtonClass(active: boolean, collapsed: boolean) {
  return [
    "group flex w-full items-center rounded-dawn-md py-2 text-sm transition-colors",
    collapsed ? "justify-center px-0" : "gap-2.5 border-l-2 pl-1.5 pr-2",
    collapsed
      ? ""
      : active
        ? "border-brand/80 bg-fill text-ink"
        : "border-transparent text-muted hover:bg-fill hover:text-ink",
    collapsed && active ? "bg-fill text-ink" : "",
    collapsed && !active ? "text-muted hover:bg-fill" : ""
  ].join(" ");
}

function NavIconBox({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={[
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md transition-colors",
        active
          ? "bg-brand/18 text-brand shadow-[inset_0_0_0_1px_rgba(108,92,231,0.22)] dark:bg-brand/22"
          : "bg-fill text-muted group-hover:bg-track group-hover:text-ink"
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, authRequired, user } = useAuth();

  /** 需鉴权且无会话时，子路由回到可登录页（首页或设置内嵌登录） */
  useEffect(() => {
    if (!ready || authRequired !== true) return;
    if (user) return;
    const authLanding =
      pathname === "/" ||
      pathname === "/me" ||
      (pathname?.startsWith("/me/") ?? false) ||
      pathname === "/settings" ||
      (pathname?.startsWith("/settings/") ?? false);
    if (!pathname || authLanding) return;
    router.replace("/");
  }, [ready, authRequired, user, pathname, router]);
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  const navPrimary = useMemo<NavItem[]>(
    () => [{ href: "/", label: t("nav.home"), short: "首", Icon: IconHome }],
    [t]
  );
  const notesNavMain = useMemo<NavItem>(
    () => ({
      href: "/notes",
      label: t("nav.notes"),
      short: "笔",
      Icon: IconNotes,
      activeMatch: (p) => p === "/notes" || p === "/notes/"
    }),
    [t]
  );
  const navProducts = useMemo<NavItem[]>(
    () => [
      { href: "/podcast", label: t("nav.podcast"), short: "播", Icon: IconMic },
      { href: "/tts", label: t("nav.tts"), short: "读", Icon: IconTts },
      {
        href: "/voice",
        label: t("nav.voice"),
        short: "音",
        Icon: IconVoice,
        activeMatch: (p) => p === "/voice" || p === "/voice/"
      },
      { href: "/notes/templates", label: t("nav.templates"), short: "创", Icon: IconTemplate }
    ],
    [t]
  );
  const navLibrary = useMemo<NavItem[]>(
    () => [
      { href: "/works", label: t("nav.works"), short: "作", Icon: IconGrid },
      {
        href: "/drafts",
        label: t("nav.drafts"),
        short: "草",
        Icon: IconDraft,
        activeMatch: (p) => p === "/drafts" || p === "/drafts/"
      },
      { href: "/notes/trash", label: t("nav.trash"), short: "删", Icon: IconTrash },
      { href: "/search", label: t("nav.search"), short: "搜", Icon: IconSearch }
    ],
    [t]
  );

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(COLLAPSE_KEY);
      if (v === "1") setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-muted">
        <p className="text-sm">加载中…</p>
      </div>
    );
  }

  // 会话已解析且无用户时在首页全屏登录；设置页内嵌登录保留侧栏
  if (authRequired && !user && pathname === "/" && ready) {
    return <>{children}</>;
  }

  const isAdmin = String((user as { role?: string })?.role || "") === "admin";

  function linkActive(item: NavItem): boolean {
    if (item.activeMatch) return item.activeMatch(pathname);
    return pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
  }

  function renderLink(item: NavItem) {
    const active = linkActive(item);
    const label = collapsed && item.short ? item.short : item.label;
    const Ic = item.Icon;
    return (
      <Link key={item.href} href={item.href} className={navButtonClass(active, collapsed)} title={item.label}>
        <NavIconBox active={active}>
          <Ic />
        </NavIconBox>
        {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
      </Link>
    );
  }

  return (
    <div className="relative flex min-h-screen bg-canvas text-ink">
      <a
        href="#main-content"
        className="absolute left-[-9999px] z-[300] focus:left-4 focus:top-4 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        {t("nav.skipToContent")}
      </a>
      <aside
        className={`flex h-svh min-h-0 flex-shrink-0 flex-col border-r border-line bg-surface/95 backdrop-blur-sm transition-[width] duration-200 ease-out motion-reduce:transition-none ${
          collapsed ? "w-[72px]" : "w-[232px]"
        }`}
      >
        <div className={`flex shrink-0 items-start border-b border-line py-2 ${collapsed ? "justify-center px-2" : "gap-2 px-2.5"}`}>
          <BrandGlyph size={36} />
          {!collapsed ? (
            <div className="min-w-0 flex-1 pr-1">
              <p className="text-[13px] font-bold leading-tight text-ink">{t("nav.brandTitle")}</p>
              <p className="mt-0.5 text-[10px] italic leading-snug text-muted">{t("nav.brandTagline")}</p>
            </div>
          ) : null}
          <button
            type="button"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center self-start rounded-lg text-muted hover:bg-fill hover:text-ink"
            onClick={toggleCollapsed}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          >
            <Chevron collapsed={collapsed} />
          </button>
        </div>

        <nav
          className="mx-1.5 mt-1 min-h-0 shrink-0 overflow-y-auto overflow-x-hidden px-0.5 py-1 [scrollbar-gutter:stable]"
          style={{ maxHeight: "min(calc(100dvh - 15rem), 28rem)" }}
          aria-label={t("nav.mainNavLabel")}
        >
          {navPrimary.map(renderLink)}
          {!collapsed ? (
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted/90" role="presentation">
              {t("nav.products")}
            </p>
          ) : (
            <div className="my-0.5 border-t border-line" aria-hidden />
          )}
          {renderLink(notesNavMain)}
          {navProducts.map(renderLink)}
          {!collapsed ? (
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted/90" role="presentation">
              {t("nav.library")}
            </p>
          ) : (
            <div className="my-0.5 border-t border-line" aria-hidden />
          )}
          {navLibrary.map(renderLink)}
        </nav>

        {isAdmin ? (
          <div className="mx-1.5 mt-1 shrink-0 space-y-0.5 border-t border-line/90 px-0.5 pb-1 pt-2">
            {renderLink({ href: "/subscription", label: t("nav.subscription"), short: "订", Icon: IconSubscription })}
            {renderLink({
              href: "/admin/hub",
              label: t("nav.console"),
              short: "后",
              Icon: IconAdmin,
              activeMatch: (p) =>
                p === "/admin/hub" ||
                p.startsWith("/admin/users") ||
                p.startsWith("/admin/models") ||
                p.startsWith("/admin/usage") ||
                p.startsWith("/admin/usage-users") ||
                p.startsWith("/admin/usage-works") ||
                p.startsWith("/admin/usage-alerts") ||
                p.startsWith("/admin/tts-polish") ||
                p.startsWith("/admin/subscription-matrix") ||
                p.startsWith("/admin/subscription-pay") ||
                p === "/jobs" ||
                p.startsWith("/jobs/")
            })}
          </div>
        ) : null}

        <div className="shrink-0 border-t border-line p-2">
          {renderLink({
            href: "/me",
            label: t("nav.my"),
            short: "我",
            Icon: IconUser,
            activeMatch: (p) => p === "/me" || p.startsWith("/me/")
          })}
        </div>
      </aside>

      <div id="main-content" className="flex min-h-screen min-w-0 flex-1 flex-col" tabIndex={-1}>
        <OnboardingModal />
        <div key={pathname} className="fym-page-enter fym-page-shell">
          {children}
        </div>
        <footer className="mt-auto border-t border-line bg-fill/90 px-4 py-6" role="contentinfo">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
            <nav
              className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted"
              aria-label={t("footer.linksNavLabel")}
            >
              <Link href="/help#docs" className="text-brand hover:underline">
                {t("footer.linkDocs")}
              </Link>
              <Link href="/help#status" className="text-brand hover:underline">
                {t("footer.linkStatus")}
              </Link>
              <Link href="/help#legal" className="text-brand hover:underline">
                {t("footer.linkLegal")}
              </Link>
            </nav>
            <div className="text-center">
              <p className="text-xs tracking-wide text-muted">{t("footer.pageBrandLine")}</p>
              <p className="mt-2 text-sm text-ink">{t("footer.tag2")}</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
