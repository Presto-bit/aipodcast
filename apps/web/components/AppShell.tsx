"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode
} from "react";
import {
  IconAdmin,
  IconCreate,
  IconDraft,
  IconGrid,
  IconHome,
  IconNotes,
  IconSubscription,
  IconUser,
  IconTemplate,
  IconTrash,
  IconVoice
} from "./NavIcons";
import { useAuth } from "../lib/auth";
import {
  APP_SIDEBAR_COLLAPSED_KEY as COLLAPSE_KEY,
  APP_SIDEBAR_COLLAPSE_EVENT,
  APP_SIDEBAR_TOGGLE_EVENT
} from "../lib/appSidebarCollapse";
import { useI18n } from "../lib/I18nContext";
import PageTour from "./PageTour";
import BrandGlyph from "./brand/BrandGlyph";
import { dispatchNotesOpenWorkbench } from "../lib/notesLastNotebook";
import {
  FOOTER_LINK_CLASS,
  NAV_SECTION_DIVIDER_COLLAPSED_CLASS,
  NAV_SECTION_LABEL_CLASS,
  ADMIN_ROLE,
  NAV_SCROLL_MAX_HEIGHT,
  SIDEBAR_COLLAPSED_STORAGE,
  SIDEBAR_EXPANDED_STORAGE,
  SIDEBAR_WIDTH_COLLAPSED_CLASS,
  SIDEBAR_WIDTH_EXPANDED_CLASS
} from "../lib/appShellLayout";
import {
  isAuthPublicPath,
  matchesAdminConsole,
  matchesNotesWorkbench,
  matchesProductStudio,
  normalizePathname,
  NOTES_TEMPLATES_PREFIX,
  NOTES_TRASH_PREFIX,
  pathMatchesRoot
} from "../lib/navPaths";
import { readLocalStorageScoped, writeLocalStorageScoped } from "../lib/userScopedStorage";

type NavItem = {
  href: string;
  label: string;
  short?: string;
  Icon: ComponentType<object>;
  /** 自定义高亮（例如子路由需与父入口同时高亮） */
  activeMatch?: (pathname: string) => boolean;
  /** 点击时拦截默认跳转（如已在目标页需重复进入某状态） */
  onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void;
};

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
    </svg>
  );
}

function navButtonClass(active: boolean, collapsed: boolean): string {
  const base = "group flex w-full items-center rounded-dawn-md py-2 text-sm transition-colors";
  if (collapsed) {
    return [base, "justify-center px-0", active ? "bg-fill text-ink" : "text-muted hover:bg-fill"].join(" ");
  }
  return [
    base,
    "gap-2.5 border-l-2 pl-1.5 pr-2",
    active ? "border-brand/80 bg-fill text-ink" : "border-transparent text-muted hover:bg-fill hover:text-ink"
  ].join(" ");
}

function NavSectionHeader({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  if (collapsed) return <div className={NAV_SECTION_DIVIDER_COLLAPSED_CLASS} aria-hidden />;
  return (
    <p className={NAV_SECTION_LABEL_CLASS} role="presentation">
      {children}
    </p>
  );
}

function NavIconBox({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={[
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md transition-colors",
        active
          ? "bg-brand/18 text-brand shadow-inset-brand dark:bg-brand/22"
          : "bg-fill text-muted group-hover:bg-track group-hover:text-ink"
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const path = pathname ?? "";
  const router = useRouter();
  const { ready, authRequired, user } = useAuth();

  /** 需鉴权且无会话时，子路由回到可登录页（首页或设置内嵌登录） */
  useEffect(() => {
    if (!ready || authRequired !== true) return;
    if (user) return;
    if (!pathname || isAuthPublicPath(pathname)) return;
    router.replace("/");
  }, [ready, authRequired, user, pathname, router]);
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  const navPrimary = useMemo<NavItem[]>(
    () => [{ href: "/", label: t("nav.home"), short: "首", Icon: IconHome }],
    [t]
  );
  const navProducts = useMemo<NavItem[]>(
    () => [
      {
        href: "/notes",
        label: t("nav.notes"),
        short: "笔",
        Icon: IconNotes,
        activeMatch: (p) => matchesNotesWorkbench(p),
        onNavigate: (e) => {
          const p = path;
          if (p.startsWith(NOTES_TEMPLATES_PREFIX) || p.startsWith(NOTES_TRASH_PREFIX)) return;
          if (normalizePathname(p) === "/notes") {
            e.preventDefault();
            dispatchNotesOpenWorkbench();
          }
        }
      },
      {
        href: "/create",
        label: t("nav.create"),
        short: t("nav.createShort"),
        Icon: IconCreate,
        activeMatch: (p) => matchesProductStudio(p)
      },
      {
        href: "/voice",
        label: t("nav.voice"),
        short: "音",
        Icon: IconVoice,
        activeMatch: (p) => pathMatchesRoot(p, "/voice")
      },
      {
        href: "/notes/templates",
        label: t("nav.templates"),
        short: "风",
        Icon: IconTemplate,
        activeMatch: (p) => pathMatchesRoot(p, NOTES_TEMPLATES_PREFIX)
      }
    ],
    [t, path]
  );
  const navLibrary = useMemo<NavItem[]>(
    () => [
      { href: "/works", label: t("nav.works"), short: "作", Icon: IconGrid },
      {
        href: "/drafts",
        label: t("nav.drafts"),
        short: "草",
        Icon: IconDraft,
        activeMatch: (p) => pathMatchesRoot(p, "/drafts")
      },
      { href: "/notes/trash", label: t("nav.trash"), short: "删", Icon: IconTrash }
    ],
    [t]
  );
  const navSubscription = useMemo<NavItem[]>(
    () => [
      {
        href: "/subscription",
        label: t("nav.subscribe"),
        short: "订",
        Icon: IconSubscription,
        activeMatch: (p) => pathMatchesRoot(p, "/subscription")
      }
    ],
    [t]
  );

  useEffect(() => {
    try {
      const v = readLocalStorageScoped(COLLAPSE_KEY);
      if (v === SIDEBAR_COLLAPSED_STORAGE) setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onRequestCollapse = () => setCollapsed(true);
    window.addEventListener(APP_SIDEBAR_COLLAPSE_EVENT, onRequestCollapse);
    return () => window.removeEventListener(APP_SIDEBAR_COLLAPSE_EVENT, onRequestCollapse);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        writeLocalStorageScoped(COLLAPSE_KEY, next ? SIDEBAR_COLLAPSED_STORAGE : SIDEBAR_EXPANDED_STORAGE);
      } catch {
        // ignore
      }
      if (typeof window !== "undefined") {
        queueMicrotask(() => {
          window.dispatchEvent(new CustomEvent(APP_SIDEBAR_TOGGLE_EVENT));
        });
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
  if (authRequired && !user && path === "/") {
    return <>{children}</>;
  }

  const isAdmin = String((user as { role?: string })?.role || "") === ADMIN_ROLE;

  function linkActive(item: NavItem): boolean {
    if (item.activeMatch) return item.activeMatch(path);
    return path === item.href || (item.href !== "/" && path.startsWith(item.href + "/"));
  }

  function renderLink(item: NavItem) {
    const active = linkActive(item);
    const label = collapsed && item.short ? item.short : item.label;
    const Ic = item.Icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={navButtonClass(active, collapsed)}
        title={item.label}
        onClick={item.onNavigate}
      >
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
        className="absolute left-[-9999px] z-[300] focus:left-4 focus:top-4 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-brand-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        {t("nav.skipToContent")}
      </a>
      <aside
        className={`flex h-svh min-h-0 flex-shrink-0 flex-col border-r border-line bg-surface/95 backdrop-blur-sm transition-[width] duration-200 ease-out motion-reduce:transition-none ${
          collapsed ? SIDEBAR_WIDTH_COLLAPSED_CLASS : SIDEBAR_WIDTH_EXPANDED_CLASS
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
          style={{ maxHeight: NAV_SCROLL_MAX_HEIGHT }}
          aria-label={t("nav.mainNavLabel")}
        >
          {navPrimary.map(renderLink)}
          <NavSectionHeader collapsed={collapsed}>{t("nav.products")}</NavSectionHeader>
          {navProducts.map(renderLink)}
          <NavSectionHeader collapsed={collapsed}>{t("nav.library")}</NavSectionHeader>
          {navLibrary.map(renderLink)}
        </nav>

        {isAdmin ? (
          <div className="mx-1.5 mt-1 shrink-0 space-y-0.5 border-t border-line/90 px-0.5 pb-1 pt-2">
            {renderLink({
              href: "/admin/hub",
              label: t("nav.console"),
              short: "后",
              Icon: IconAdmin,
              activeMatch: (p) => matchesAdminConsole(p)
            })}
          </div>
        ) : null}

        <div className="shrink-0 space-y-0.5 border-t border-line p-2">
          {navSubscription.map(renderLink)}
          {renderLink({
            href: "/me/subscription",
            label: t("nav.my"),
            short: "我",
            Icon: IconUser,
            activeMatch: (p) => pathMatchesRoot(p, "/me")
          })}
        </div>
      </aside>

      <div id="main-content" className="flex min-h-screen min-w-0 flex-1 flex-col" tabIndex={-1}>
        <PageTour />
        <div key={path} className="fym-page-enter fym-page-shell">
          {children}
        </div>
        <footer className="mt-auto border-t border-line bg-fill/90 px-4 py-6" role="contentinfo">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
            <nav
              className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted"
              aria-label={t("footer.linksNavLabel")}
            >
              {(
                [
                  { href: "/help#docs", labelKey: "footer.linkDocs" },
                  { href: "/help#status", labelKey: "footer.linkStatus" },
                  { href: "/help#legal", labelKey: "footer.linkLegal" }
                ] as const
              ).map(({ href, labelKey }) => (
                <Link key={href} href={href} className={FOOTER_LINK_CLASS}>
                  {t(labelKey)}
                </Link>
              ))}
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
