"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type ComponentType,
  type HTMLAttributes,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction
} from "react";
import {
  IconChevronLeft,
  IconChevronSidebar,
  IconCreate,
  IconDraft,
  IconGrid,
  IconHome,
  IconMenu,
  IconNotes,
  IconSubscription,
  IconTrash,
  IconUser
} from "./icons";
import { isLoggedInAccountUser, useAuth } from "../lib/auth";
import {
  APP_SIDEBAR_COLLAPSED_KEY as COLLAPSE_KEY,
  APP_SIDEBAR_COLLAPSE_EVENT,
  APP_SIDEBAR_TOGGLE_EVENT
} from "../lib/appSidebarCollapse";
import { useI18n } from "../lib/I18nContext";
import AnimatedPageShell from "./AnimatedPageShell";
import WorkAudioShell from "./WorkAudioShell";
import ActiveJobsProvider from "./ActiveJobsProvider";
import BrandGlyph from "./brand/BrandGlyph";
const NotesNavExpanded = dynamic(() => import("./notes/NotesNavExpanded"), { ssr: false });
const NotesWorkbenchMinimalRail = dynamic(() => import("./notes/NotesWorkbenchMinimalRail"), { ssr: false });
import { dispatchNotesShowNotebookHub, NOTES_MINIMAL_MAIN_NAV_EVENT } from "../lib/notesLastNotebook";
import {
  APP_SHELL_MOBILE_MEDIA_QUERY,
  NAV_SECTION_DIVIDER_COLLAPSED_CLASS,
  NAV_SECTION_LABEL_CLASS,
  SIDEBAR_COLLAPSED_STORAGE,
  SIDEBAR_EXPANDED_STORAGE,
  SIDEBAR_WIDTH_COLLAPSED_PX,
  SIDEBAR_WIDTH_EXPANDED_PX,
  SIDEBAR_WIDTH_NOTES_WORKBENCH_RAIL_PX
} from "../lib/appShellLayout";
import {
  isMarketingShellLessPath,
  matchesNotesWorkbench,
  matchesProductStudio,
  normalizePathname,
  NOTES_TEMPLATES_PREFIX,
  NOTES_TRASH_PREFIX,
  pathMatchesRoot,
  pathNeedsWorkAudio,
  WORKBENCH_HOME_PATH,
  WORKBENCH_NAV_PREFETCH
} from "../lib/navPaths";
import { readLocalStorageScoped, writeLocalStorageScoped } from "../lib/userScopedStorage";
import { reportFrontendGlobalError } from "../lib/frontendGlobalErrorClient";
import { SkeletonBlock, SkeletonLine } from "./ui/Skeleton";

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
  return <IconChevronSidebar collapsed={collapsed} />;
}

function MobileMenuGlyph({ open }: { open: boolean }) {
  return <IconMenu open={open} />;
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

/** 与侧栏「知识库」button 分支一致：/notes 主路由及笔记本工作台（非模板/回收站/author-ip） */
function isNotesPrimaryWorkbenchPath(pathname: string): boolean {
  const n = normalizePathname(pathname);
  if (!pathMatchesRoot(n, "/notes")) return false;
  if (pathname.startsWith(NOTES_TEMPLATES_PREFIX) || pathname.startsWith(NOTES_TRASH_PREFIX)) return false;
  if (n.startsWith("/notes/author-ip")) return false;
  return n === "/notes" || n.startsWith("/notes/");
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
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-all duration-150",
        active
          ? "bg-brand/20 text-brand shadow-inset-brand ring-1 ring-brand/30 dark:bg-brand/24"
          : "bg-fill/90 text-muted ring-1 ring-line/55 group-hover:bg-track group-hover:text-ink group-hover:ring-line/80"
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function navCreateSubLinkClass(active: boolean): string {
  return [
    "group flex w-full items-center rounded-dawn-md border-l-2 py-1.5 pl-1.5 pr-2 text-left text-xs leading-snug text-inherit no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    active ? "border-brand/80 bg-fill text-ink" : "border-transparent text-muted hover:bg-fill hover:text-ink"
  ].join(" ");
}

type CreateStudioNavExpandedProps = {
  item: NavItem;
  path: string;
  createSubNavExpanded: boolean;
  setCreateSubNavExpanded: Dispatch<SetStateAction<boolean>>;
};

function CreateStudioNavExpanded({
  item,
  path,
  createSubNavExpanded,
  setCreateSubNavExpanded
}: CreateStudioNavExpandedProps) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") ?? null;
  const voiceManageActive =
    pathMatchesRoot(path, "/voice") && (tab === null || tab === "clone");

  /** 策略 A：仅「创作工作室」路由（/create、/podcast、/tts）父行高亮；在 /clip、/shownotes、/voice 等仅子项高亮。 */
  const parentRouteActive = Boolean(item.activeMatch?.(path));
  const Ic = item.Icon;
  const parentTip = item.linkTitle ?? item.label;

  const parentInner = (
    <>
      <NavIconBox active={parentRouteActive}>
        <Ic />
      </NavIconBox>
      <span className="min-w-0 flex-1 truncate text-left leading-snug">{item.label}</span>
    </>
  );

  const parentClass = navButtonClass(parentRouteActive, false);

  const onParentClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (createSubNavExpanded) {
      e.preventDefault();
      setCreateSubNavExpanded(false);
    } else {
      setCreateSubNavExpanded(true);
    }
  };

  const subs: { href: string; label: string; active: boolean }[] = [
    { href: "/clip", label: t("create.quickLink.clip"), active: pathMatchesRoot(path, "/clip") },
    { href: "/shownotes", label: t("create.quickLink.shownotes"), active: pathMatchesRoot(path, "/shownotes") },
    { href: "/voice", label: t("create.quickLink.voiceClone"), active: voiceManageActive }
  ];

  return (
    <div className="flex w-full flex-col gap-0.5">
      <Link
        href="/create"
        prefetch={WORKBENCH_NAV_PREFETCH}
        className={parentClass}
        title={parentTip}
        aria-expanded={createSubNavExpanded}
        aria-controls="fym-create-studio-subnav"
        onClick={onParentClick}
      >
        {parentInner}
      </Link>
      {createSubNavExpanded ? (
        <div
          id="fym-create-studio-subnav"
          role="group"
          aria-label={t("nav.createSubNavGroup")}
          className="ml-10 flex flex-col gap-0.5"
        >
          {subs.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              prefetch={WORKBENCH_NAV_PREFETCH}
              className={navCreateSubLinkClass(s.active)}
              title={s.label}
              aria-current={s.active ? "page" : undefined}
            >
              <span className="min-w-0 truncate">{s.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const path = pathname ?? "";
  const { ready, user } = useAuth();
  const loggedIn = isLoggedInAccountUser(user);

  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  /** 知识库已进入笔记本工作台：主导航收起，仅保留左侧浮动返回入口 */
  const [notesMinimalMainNav, setNotesMinimalMainNav] = useState(false);
  /** 与 APP_SHELL_MOBILE_MEDIA_QUERY 一致（窄于 1024px）：侧栏改为抽屉，主区全宽 */
  const [mobileLayout, setMobileLayout] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuFabRef = useRef<HTMLButtonElement>(null);
  /**
   * 侧栏挂 body：用 useLayoutEffect 在首帧 paint 前 portal，避免与 #__next 同帧叠层竞争（极端环境下
   * 曾出现「只有个别侧栏项可点」的命中错乱）。
   */
  const [sidebarPortaled, setSidebarPortaled] = useState(false);
  const [createSubNavExpanded, setCreateSubNavExpanded] = useState(true);
  const [notesSubNavExpanded, setNotesSubNavExpanded] = useState(true);
  const navPrimary = useMemo<NavItem[]>(
    () => [{ href: WORKBENCH_HOME_PATH, label: t("nav.home"), short: "首", Icon: IconHome }],
    [t]
  );
  const navProducts = useMemo<NavItem[]>(
    () => [
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
    ],
    [t]
  );
  const navLibrary = useMemo<NavItem[]>(
    () => [
      { href: "/works", label: t("nav.works"), short: "作", Icon: IconGrid },
      {
        href: "/drafts",
        label: t("nav.drafts"),
        short: "本",
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
        short: "余",
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

  useEffect(() => {
    const onNotesMinimal = (ev: Event) => {
      const ce = ev as CustomEvent<{ minimal?: boolean }>;
      setNotesMinimalMainNav(Boolean(ce.detail?.minimal));
    };
    window.addEventListener(NOTES_MINIMAL_MAIN_NAV_EVENT, onNotesMinimal);
    return () => window.removeEventListener(NOTES_MINIMAL_MAIN_NAV_EVENT, onNotesMinimal);
  }, []);

  useEffect(() => {
    if (!isNotesPrimaryWorkbenchPath(path)) setNotesMinimalMainNav(false);
  }, [path]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(APP_SHELL_MOBILE_MEDIA_QUERY);
    const onChange = () => {
      const m = mq.matches;
      setMobileLayout(m);
      if (!m) {
        const root = sidebarRef.current;
        const active = document.activeElement;
        if (root && active instanceof HTMLElement && root.contains(active)) {
          active.blur();
        }
        setMobileNavOpen(false);
      }
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** 关闭抽屉前先把焦点移出侧栏，避免 inert 与焦点冲突 */
  const closeMobileNav = useCallback((focusTarget: "fab" | "blur" = "fab") => {
    const root = sidebarRef.current;
    const active = document.activeElement;
    if (root && active instanceof HTMLElement && root.contains(active)) {
      if (focusTarget === "fab") {
        mobileMenuFabRef.current?.focus({ preventScroll: true });
      } else {
        active.blur();
      }
    }
    setMobileNavOpen(false);
  }, []);

  /** 窄屏抽屉打开时用展开宽度，避免 72px 折叠轨 + 汉堡叠层导致入口难辨 */
  const toggleMobileNav = useCallback(() => {
    if (mobileNavOpen) {
      closeMobileNav("fab");
      return;
    }
    setCollapsed(false);
    try {
      writeLocalStorageScoped(COLLAPSE_KEY, SIDEBAR_EXPANDED_STORAGE);
    } catch {
      // ignore
    }
    setMobileNavOpen(true);
  }, [closeMobileNav, mobileNavOpen]);

  useEffect(() => {
    closeMobileNav("blur");
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    if (pathMatchesRoot(path, "/create")) setCreateSubNavExpanded(true);
  }, [path]);

  useEffect(() => {
    if (!mobileLayout || !mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobileNav("fab");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMobileNav, mobileLayout, mobileNavOpen]);

  useEffect(() => {
    if (!mobileLayout || !mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileLayout, mobileNavOpen]);

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      reportFrontendGlobalError({
        source: "onerror",
        message: event.message || "window_error",
        location:
          typeof event.filename === "string" && event.filename
            ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
            : undefined,
        data: {
          stack: event.error && typeof event.error === "object" ? (event.error as { stack?: unknown }).stack : undefined
        }
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason && typeof reason === "object" && "message" in (reason as object)
          ? String((reason as { message?: unknown }).message || "promise_rejection")
          : String(reason ?? "promise_rejection");
      const stack =
        reason && typeof reason === "object" && "stack" in (reason as object)
          ? String((reason as { stack?: unknown }).stack || "")
          : "";
      reportFrontendGlobalError({
        source: "unhandledrejection",
        message,
        data: { stack }
      });
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
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
    if (isMarketingShellLessPath(path)) {
      document.documentElement.style.setProperty("--fym-app-sidebar-w", "0px");
      return;
    }
    if (mobileLayout) {
      document.documentElement.style.setProperty("--fym-app-sidebar-w", "0px");
      return;
    }
    const minimalRail = notesMinimalMainNav && isNotesPrimaryWorkbenchPath(path);
    const px = minimalRail
      ? SIDEBAR_WIDTH_NOTES_WORKBENCH_RAIL_PX
      : collapsed
        ? SIDEBAR_WIDTH_COLLAPSED_PX
        : SIDEBAR_WIDTH_EXPANDED_PX;
    document.documentElement.style.setProperty("--fym-app-sidebar-w", `${px}px`);
    // 不在 cleanup 里 removeProperty：Strict Mode / 依赖重跑时会出现一帧变量缺失，
    // 全屏级 z-index 遮罩会短暂盖住侧栏；无壳场景由上面分支显式清除即可。
  }, [collapsed, ready, notesMinimalMainNav, path, mobileLayout]);

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

  const pageShell = <AnimatedPageShell>{children}</AnimatedPageShell>;
  const shellChildren = isMarketingShellLessPath(path) ? (
    pageShell
  ) : (
    <ActiveJobsProvider enabled={ready && loggedIn}>
      {pathNeedsWorkAudio(path) ? <WorkAudioShell>{pageShell}</WorkAudioShell> : pageShell}
    </ActiveJobsProvider>
  );

  if (!ready) {
    if (isMarketingShellLessPath(path)) {
      return <div className="relative min-h-screen bg-canvas text-ink">{shellChildren}</div>;
    }
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <div className="flex min-h-screen">
          <aside className="hidden w-[232px] shrink-0 border-r border-line bg-surface/80 px-3 py-4 sm:block" aria-hidden>
            <SkeletonLine className="h-9 w-9 rounded-lg" />
            <SkeletonLine className="mt-4 h-4 w-24" />
            <SkeletonLine className="mt-2 h-9 w-full rounded-lg" />
            <SkeletonLine className="mt-2 h-9 w-full rounded-lg" />
            <SkeletonLine className="mt-6 h-4 w-20" />
            <SkeletonLine className="mt-2 h-9 w-full rounded-lg" />
            <SkeletonLine className="mt-2 h-9 w-full rounded-lg" />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col px-4 py-6 sm:px-8">
            <SkeletonLine className="h-8 w-48 max-w-[80%]" />
            <SkeletonLine className="mt-3 h-4 w-full max-w-xl" />
            <SkeletonBlock className="mt-8 h-52 w-full max-w-3xl rounded-xl" />
            <SkeletonBlock className="mt-6 h-36 w-full max-w-3xl rounded-xl" />
            <p className="mt-6 text-center text-xs text-muted">正在加载工作台…</p>
          </div>
        </div>
      </div>
    );
  }

  if (isMarketingShellLessPath(path)) {
    return (
      <div className="relative min-h-screen bg-canvas text-ink">
        <a
          href="#main-content"
          className="absolute left-[-9999px] z-[300] focus:left-4 focus:top-4 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-brand-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {t("nav.skipToContent")}
        </a>
        <div id="main-content" data-fym-app-main className="flex min-h-screen min-w-0 flex-col" tabIndex={-1}>
          {shellChildren}
        </div>
      </div>
    );
  }

  function linkActive(item: NavItem): boolean {
    if (item.activeMatch) return item.activeMatch(path);
    return (
      path === item.href || (item.href !== WORKBENCH_HOME_PATH && path.startsWith(item.href + "/"))
    );
  }

  /**
   * 侧栏主导航：
   * - 「工作台首页」与其它入口一致用 Link 软路由 + prefetch。
   * - 仍在 /notes 主路径时，「知识库」用 next/link + preventDefault 调 hub：保留 href 利于无障碍与右键新开。
   * - 其余入口：next/link 软路由 + prefetch。
   */
  function renderSidebarNavItem(item: NavItem) {
    const active = linkActive(item);
    const label = collapsed && item.short ? item.short : item.label;
    const Ic = item.Icon;
    const tip = item.linkTitle ?? item.label;
    if (item.href === WORKBENCH_HOME_PATH) {
      return (
        <Link
          key={item.href}
          href={WORKBENCH_HOME_PATH}
          prefetch={WORKBENCH_NAV_PREFETCH}
          className={navButtonClass(active, collapsed)}
          title={tip}
        >
          <NavIconBox active={active}>
            <Ic />
          </NavIconBox>
          {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
        </Link>
      );
    }
    if (item.href === "/notes" && isNotesPrimaryWorkbenchPath(path)) {
      return (
        <Link
          key={item.href}
          href="/notes"
          prefetch={WORKBENCH_NAV_PREFETCH}
          className={navButtonClass(active, collapsed)}
          title={tip}
          onClick={(e) => {
            e.preventDefault();
            dispatchNotesShowNotebookHub();
          }}
        >
          <NavIconBox active={active}>
            <Ic />
          </NavIconBox>
          {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
        </Link>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={WORKBENCH_NAV_PREFETCH}
        className={navButtonClass(active, collapsed)}
        title={tip}
      >
        <NavIconBox active={active}>
          <Ic />
        </NavIconBox>
        {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
      </Link>
    );
  }

  const notesNavMinimalRail = notesMinimalMainNav && isNotesPrimaryWorkbenchPath(path);
  /** 桌面端笔记本工作台用 48px 窄轨；移动端始终挂载完整侧栏抽屉，避免汉堡无 `#fym-app-sidebar-root` 可开 */
  const useFullSidebar = mobileLayout || !notesNavMinimalRail;
  const sidebarOffCanvas = mobileLayout && !mobileNavOpen;
  const sidebarDrawerPx = collapsed ? SIDEBAR_WIDTH_COLLAPSED_PX : SIDEBAR_WIDTH_EXPANDED_PX;

  const fullSidebarEl = (
    <aside
      ref={sidebarRef}
      id="fym-app-sidebar-root"
      data-fym-app-sidebar
      {...(sidebarOffCanvas ? ({ inert: true } as HTMLAttributes<HTMLElement>) : {})}
      className={[
        "fixed left-0 top-0 z-[100000] flex h-svh min-h-0 flex-col border-r border-line bg-surface/95 backdrop-blur-sm transition-[width,transform] duration-200 ease-out motion-reduce:transition-none",
        sidebarOffCanvas ? "-translate-x-full pointer-events-none" : "translate-x-0 pointer-events-auto",
        mobileLayout ? "shadow-card" : ""
      ].join(" ")}
      style={{ width: `${sidebarDrawerPx}px` }}
    >
      <div
        className={`flex w-full shrink-0 items-center border-b border-line py-2 ${collapsed ? "justify-center px-2" : "justify-between gap-2 px-2.5"}`}
      >
        <Link
          href="/"
          prefetch={WORKBENCH_NAV_PREFETCH}
          className={[
            "flex shrink-0 items-center rounded-lg p-0.5 outline-offset-2 ring-offset-canvas transition-colors hover:bg-fill/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35",
            collapsed ? "justify-center" : ""
          ].join(" ")}
          aria-label={t("nav.brandHomeLink")}
        >
          <BrandGlyph size={36} />
        </Link>
        <button
          type="button"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-fill hover:text-ink"
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
        onClick={(e) => {
          if (!mobileLayout || !mobileNavOpen) return;
          const el = e.target as HTMLElement;
          if (el.closest("a, [href]")) closeMobileNav("blur");
        }}
      >
        {navPrimary.map(renderSidebarNavItem)}
        <NavSectionHeader collapsed={collapsed}>{t("nav.products")}</NavSectionHeader>
        {navProducts.map((item) =>
          item.href === "/create" ? (
            <Fragment key={item.href}>
              {collapsed ? (
                renderSidebarNavItem(item)
              ) : (
                <CreateStudioNavExpanded
                  item={item}
                  path={path}
                  createSubNavExpanded={createSubNavExpanded}
                  setCreateSubNavExpanded={setCreateSubNavExpanded}
                />
              )}
            </Fragment>
          ) : item.href === "/notes" ? (
            <Fragment key={item.href}>
              {collapsed ? (
                renderSidebarNavItem(item)
              ) : (
                <NotesNavExpanded
                  item={item}
                  path={path}
                  notesSubNavExpanded={notesSubNavExpanded}
                  setNotesSubNavExpanded={setNotesSubNavExpanded}
                  NavIconBox={NavIconBox}
                />
              )}
            </Fragment>
          ) : (
            renderSidebarNavItem(item)
          )
        )}
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

  const notesMinimalRailEl =
    notesNavMinimalRail && !mobileLayout ? (
      <NotesWorkbenchMinimalRail
        homeLabel={t("nav.home")}
        notesLabel={t("nav.notes")}
        createLabel={t("nav.create")}
      />
    ) : null;

  const sidebarAside = useFullSidebar ? fullSidebarEl : notesMinimalRailEl;

  const mobileNavBackdrop =
    mobileLayout && mobileNavOpen ? (
      <button
        type="button"
        className="fixed inset-0 z-[99990] bg-black/40 backdrop-blur-[1px]"
        aria-label={t("nav.closeMenu")}
        onClick={() => closeMobileNav("fab")}
      />
    ) : null;

  const mobileMenuFab =
    mobileLayout && ready ? (
      <button
        ref={mobileMenuFabRef}
        type="button"
        className="fixed left-0 top-0 z-[100002] flex h-12 min-h-[48px] w-12 min-w-[48px] items-center justify-center rounded-br-dawn-lg border-b border-r border-line/80 bg-surface/95 text-ink shadow-soft backdrop-blur-sm transition-colors hover:bg-fill motion-reduce:transition-none"
        style={{
          paddingTop: "max(0.25rem, env(safe-area-inset-top, 0px))",
          paddingLeft: "max(0.25rem, env(safe-area-inset-left, 0px))"
        }}
        aria-expanded={mobileNavOpen}
        aria-controls={useFullSidebar ? "fym-app-sidebar-root" : undefined}
        title={mobileNavOpen ? t("nav.closeMenu") : t("nav.openMenu")}
        aria-label={mobileNavOpen ? t("nav.closeMenu") : t("nav.openMenu")}
        onClick={() => toggleMobileNav()}
      >
        <MobileMenuGlyph open={mobileNavOpen} />
      </button>
    ) : null;

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
      {sidebarPortaled
        ? createPortal(
            <>
              {mobileNavBackdrop}
              {mobileMenuFab}
              {sidebarAside}
            </>,
            document.body
          )
        : sidebarAside}

      <div
        id="main-content"
        data-fym-app-main
        className={[
          "flex min-h-screen min-w-0 flex-col",
          mobileLayout ? "pt-[max(3.5rem,calc(2.75rem+env(safe-area-inset-top,0px)))]" : ""
        ].join(" ")}
        style={{ marginLeft: "var(--fym-app-sidebar-w, 232px)" }}
        tabIndex={-1}
      >
        {shellChildren}
        {normalizePathname(path) === WORKBENCH_HOME_PATH ? null : (
          <footer className="relative z-[405] mt-auto border-t border-line bg-fill/90 px-4 py-6" role="contentinfo">
            <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
              <div className="text-center">
                <p className="text-xs tracking-wide text-muted">{t("footer.pageBrandLine")}</p>
                <p className="mt-2 text-sm text-ink">{t("footer.tag2")}</p>
              </div>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
