"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import {
  IconClip,
  IconCreate,
  IconDraft,
  IconGrid,
  IconHome,
  IconNotes,
  IconSubscription,
  IconUser,
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
import AnimatedPageShell from "./AnimatedPageShell";
import BrandGlyph from "./brand/BrandGlyph";
import { SiteBeianBar } from "./SiteBeianBar";
import { dispatchNotesShowNotebookHub } from "../lib/notesLastNotebook";
import {
  NAV_SECTION_DIVIDER_COLLAPSED_CLASS,
  NAV_SECTION_LABEL_CLASS,
  ADMIN_ROLE,
  SIDEBAR_COLLAPSED_STORAGE,
  SIDEBAR_EXPANDED_STORAGE,
  SIDEBAR_WIDTH_COLLAPSED_PX,
  SIDEBAR_WIDTH_EXPANDED_PX
} from "../lib/appShellLayout";
import { isClipNavPublicForAllUsers } from "../lib/clipNavAccess";
import {
  isAuthPublicPath,
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
  /** 侧栏收起时 title 与无障碍说明（默认同 label） */
  linkTitle?: string;
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

function navButtonClass(active: boolean, collapsed: boolean): string {
  const base =
    "group flex w-full items-center rounded-dawn-md py-2 text-sm text-inherit no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
  if (collapsed) {
    return [base, "justify-center px-0", active ? "bg-fill text-ink" : "text-muted hover:bg-fill"].join(" ");
  }
  return [
    base,
    "gap-2.5 border-l-2 pl-1.5 pr-2",
    active ? "border-brand/80 bg-fill text-ink" : "border-transparent text-muted hover:bg-fill hover:text-ink"
  ].join(" ");
}

/** 与侧栏「知识库」button 分支一致：/notes 主路由（非模板/回收站） */
function isNotesPrimaryWorkbenchPath(pathname: string): boolean {
  return (
    normalizePathname(pathname) === "/notes" &&
    !pathname.startsWith(NOTES_TEMPLATES_PREFIX) &&
    !pathname.startsWith(NOTES_TRASH_PREFIX)
  );
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
  const routerRef = useRef(router);
  routerRef.current = router;
  const { ready, authRequired, user } = useAuth();

  /** 需鉴权且无会话时，子路由回到可登录页（首页或设置内嵌登录） */
  useEffect(() => {
    if (!ready || authRequired !== true) return;
    if (user) return;
    if (!pathname || isAuthPublicPath(pathname)) return;
    routerRef.current.replace("/");
  }, [ready, authRequired, user, pathname]);
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  /**
   * 侧栏挂 body：用 useLayoutEffect 在首帧 paint 前 portal，避免与 #__next 同帧叠层竞争（极端环境下
   * 曾出现「只有个别侧栏项可点」的命中错乱）。
   */
  const [sidebarPortaled, setSidebarPortaled] = useState(false);
  const isAdmin = String((user as { role?: string })?.role || "") === ADMIN_ROLE;
  const clipNavPublic = isClipNavPublicForAllUsers();
  const showClipNav = isAdmin || clipNavPublic;

  const navPrimary = useMemo<NavItem[]>(
    () => [{ href: "/", label: t("nav.home"), short: "首", Icon: IconHome }],
    [t]
  );
  const navProducts = useMemo<NavItem[]>(() => {
    const clipLinkTitle =
      !clipNavPublic && showClipNav ? `${t("nav.clip")}（${t("nav.clipBadge")}）` : t("nav.clip");
    const clipItem: NavItem = {
      href: "/clip",
      label:
        !clipNavPublic && showClipNav ? `${t("nav.clip")}（${t("nav.clipBadge")}）` : t("nav.clip"),
      short: t("nav.clipShort"),
      linkTitle: clipLinkTitle,
      Icon: IconClip,
      activeMatch: (p) => pathMatchesRoot(p, "/clip")
    };
    const items: NavItem[] = [
      {
        href: "/notes",
        label: t("nav.notes"),
        short: "笔",
        Icon: IconNotes,
        activeMatch: (p) => matchesNotesWorkbench(p)
      },
      {
        href: "/create",
        label: t("nav.create"),
        short: t("nav.createShort"),
        Icon: IconCreate,
        activeMatch: (p) => matchesProductStudio(p)
      }
    ];
    if (showClipNav) items.push(clipItem);
    return items;
  }, [t, showClipNav, clipNavPublic]);
  const navLibrary = useMemo<NavItem[]>(
    () => [
      { href: "/works", label: t("nav.works"), short: "作", Icon: IconGrid },
      {
        href: "/voice",
        label: t("nav.voice"),
        short: "音",
        Icon: IconVoice,
        activeMatch: (p) => pathMatchesRoot(p, "/voice")
      },
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
    () =>
      isAdmin
        ? [
            {
              href: "/subscription",
              label: t("nav.subscribe"),
              short: "余",
              Icon: IconSubscription,
              activeMatch: (p) => pathMatchesRoot(p, "/subscription")
            }
          ]
        : [],
    [isAdmin, t]
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

  useLayoutEffect(() => {
    setSidebarPortaled(true);
  }, []);

  /**
   * 供 `.fym-workspace-scrim` 使用：遮罩从主工作区左缘起算，不盖住主导航。
   * 使用 useLayoutEffect：在 paint 前写入，避免 `--fym-app-sidebar-w` 短暂缺失时全屏遮罩盖住侧栏导致「无法点击」。
   */
  useLayoutEffect(() => {
    if (!ready) {
      document.documentElement.style.removeProperty("--fym-app-sidebar-w");
      return;
    }
    if (authRequired && !user && path === "/") {
      document.documentElement.style.removeProperty("--fym-app-sidebar-w");
      return;
    }
    const px = collapsed ? SIDEBAR_WIDTH_COLLAPSED_PX : SIDEBAR_WIDTH_EXPANDED_PX;
    document.documentElement.style.setProperty("--fym-app-sidebar-w", `${px}px`);
    // 不在 cleanup 里 removeProperty：Strict Mode / 依赖重跑时会出现一帧变量缺失，
    // 全屏级 z-index 遮罩会短暂盖住侧栏；无壳场景由上面分支显式清除即可。
  }, [collapsed, ready, authRequired, user, path]);

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

  function linkActive(item: NavItem): boolean {
    if (item.activeMatch) return item.activeMatch(path);
    return path === item.href || (item.href !== "/" && path.startsWith(item.href + "/"));
  }

  /**
   * 侧栏主导航：
   * - 仍在 /notes 主路径（hub 或笔记本内）时，「知识库」用 button 回到笔记本列表。
   * - 同状态下其它入口：仅用原生 a[href] 整页离开。/notes 页体量大，preventDefault + router.push 曾出现
   *   导航被挂起、随后在点击笔记本时与 openNotebook 竞态（先跳到上次点的路由）。
   * - 离开 /notes 主路径后：next/link 软路由。
   * 叠层：z-[100000] + useLayoutEffect portal。
   */
  function renderSidebarNavItem(item: NavItem) {
    const active = linkActive(item);
    const label = collapsed && item.short ? item.short : item.label;
    const Ic = item.Icon;
    const tip = item.linkTitle ?? item.label;
    if (item.href === "/notes" && isNotesPrimaryWorkbenchPath(path)) {
      return (
        <button
          type="button"
          key={item.href}
          className={navButtonClass(active, collapsed)}
          title={tip}
          onClick={() => dispatchNotesShowNotebookHub()}
        >
          <NavIconBox active={active}>
            <Ic />
          </NavIconBox>
          {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
        </button>
      );
    }
    if (isNotesPrimaryWorkbenchPath(path)) {
      return (
        <a key={item.href} href={item.href} className={navButtonClass(active, collapsed)} title={tip}>
          <NavIconBox active={active}>
            <Ic />
          </NavIconBox>
          {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
        </a>
      );
    }
    return (
      <Link key={item.href} href={item.href} prefetch={false} className={navButtonClass(active, collapsed)} title={tip}>
        <NavIconBox active={active}>
          <Ic />
        </NavIconBox>
        {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
      </Link>
    );
  }

  const sidebarAside = (
    <aside
      data-fym-app-sidebar
      className="fixed left-0 top-0 z-[100000] flex h-svh min-h-0 flex-col border-r border-line bg-surface/95 backdrop-blur-sm transition-[width] duration-200 ease-out motion-reduce:transition-none pointer-events-auto"
      style={{
        width: "var(--fym-app-sidebar-w, 232px)"
      }}
    >
      <div className={`flex shrink-0 items-start border-b border-line py-2 ${collapsed ? "justify-center px-2" : "gap-2 px-2.5"}`}>
        <BrandGlyph size={36} />
        {!collapsed ? (
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-[13px] font-bold leading-tight text-ink">{t("nav.brandTitle")}</p>
            <p className="mt-0.5 text-[10px] italic leading-snug text-muted">{t("nav.brandTaglineEn")}</p>
            <p className="mt-0.5 text-[10px] not-italic leading-snug text-muted">{t("nav.brandTaglineZh")}</p>
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
        className="mx-1.5 mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-0.5 py-1 [scrollbar-gutter:stable]"
        aria-label={t("nav.mainNavLabel")}
      >
        {navPrimary.map(renderSidebarNavItem)}
        <NavSectionHeader collapsed={collapsed}>{t("nav.products")}</NavSectionHeader>
        {navProducts.map(renderSidebarNavItem)}
        <NavSectionHeader collapsed={collapsed}>{t("nav.library")}</NavSectionHeader>
        {navLibrary.map(renderSidebarNavItem)}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-line p-2">
        {navSubscription.map(renderSidebarNavItem)}
        {renderSidebarNavItem({
          href: "/me/profile",
          label: t("nav.my"),
          short: "我",
          Icon: IconUser,
          activeMatch: (p) => pathMatchesRoot(p, "/me")
        })}
      </div>
    </aside>
  );

  return (
    <div className="relative min-h-screen bg-canvas text-ink">
      <a
        href="#main-content"
        className="absolute left-[-9999px] z-[300] focus:left-4 focus:top-4 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-brand-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        {t("nav.skipToContent")}
      </a>
      {/*
        主导航挂 document.body：与页面内 portal 分离，避免 #__next 子树叠层盖住 fixed 侧栏。
        z-index 取 100000：高于常见弹层（如 z-[1200]），且避免 2^31-2 级数值在部分浏览器/合成层实现异常。
      */}
      {sidebarPortaled ? createPortal(sidebarAside, document.body) : sidebarAside}

      <div
        id="main-content"
        data-fym-app-main
        className="flex min-h-screen min-w-0 flex-col"
        style={{ marginLeft: "var(--fym-app-sidebar-w, 232px)" }}
        tabIndex={-1}
      >
        <AnimatedPageShell>{children}</AnimatedPageShell>
        <footer className="relative z-[405] mt-auto border-t border-line bg-fill/90 px-4 py-6" role="contentinfo">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
            <div className="text-center">
              <p className="text-xs tracking-wide text-muted">{t("footer.pageBrandLine")}</p>
              <p className="mt-2 text-sm text-ink">{t("footer.tag2")}</p>
            </div>
            {normalizePathname(path) === "/" ? (
              <div className="w-full border-t border-line/70 pt-4">
                <SiteBeianBar />
              </div>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
