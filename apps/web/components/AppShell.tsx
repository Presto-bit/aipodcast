"use client";

import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  type ComponentType,
  type HTMLAttributes,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import {
  IconChevronLeft,
  IconGrid,
  IconHome,
  IconMenu,
  IconMic,
  IconNotes,
  IconSidebarPanelToggle,
  IconSubscription,
  IconUser
} from "./icons";
import { isLoggedInAccountUser, useAuth, userAccountRef } from "../lib/auth";
import {
  APP_SIDEBAR_COLLAPSE_EVENT,
  APP_SIDEBAR_TOGGLE_EVENT
} from "../lib/appSidebarCollapse";
import { useI18n } from "../lib/I18nContext";
import AnimatedPageShell from "./AnimatedPageShell";
import WorkAudioShell from "./WorkAudioShell";
import ActiveJobsProvider from "./ActiveJobsProvider";
import BrandGlyph from "./brand/BrandGlyph";
import NotesNavExpanded from "./notes/NotesNavExpanded";
import SidebarNavLink from "./nav/SidebarNavLink";
import WorkbenchRouteFallback from "./nav/WorkbenchRouteFallback";
import WorkbenchRouteSuspenseFallback from "./nav/WorkbenchRouteSuspenseFallback";
import WorkbenchNavProgress from "./nav/WorkbenchNavProgress";
import { WorkbenchNavContext } from "../lib/WorkbenchNavContext";
import {
  resolveWorkbenchNavWarmthTier,
  workbenchNavClearPendingDelayMs,
  workbenchNavHardJumpMs,
  type WorkbenchNavWarmthTier
} from "../lib/workbenchNavWarmth";
import { prefetchWorkbenchRoute, prefetchWorkbenchSidebarIdle, WORKBENCH_LOGIN_PREFETCH_ROUTES, WORKBENCH_LOGIN_PREFETCH_ROUTES_SECONDARY, type PrefetchWorkbenchRouteOptions } from "../lib/navPrefetch";
import {
  dispatchWorkbenchDismissOverlays,
  WORKBENCH_MOBILE_FAB_Z_CLASS,
  WORKBENCH_SIDEBAR_Z_CLASS
} from "../lib/workbenchOverlays";
import {
  APP_SHELL_MOBILE_MEDIA_QUERY,
  SIDEBAR_WIDTH_COLLAPSED_PX,
  SIDEBAR_WIDTH_EXPANDED_PX
} from "../lib/appShellLayout";
import {
  isMarketingShellLessPath,
  matchesNotesWorkbench,
  matchesProductStudio,
  matchesWorkbenchTools,
  matchesWorksTrash,
  normalizePathname,
  pathMatchesRoot,
  pathNeedsWorkAudio,
  WORKBENCH_HOME_PATH
} from "../lib/navPaths";
import { reportFrontendGlobalError } from "../lib/frontendGlobalErrorClient";

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

function readVoiceTabQuery(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("tab");
  } catch {
    return null;
  }
}

type StudioToolsNavExpandedProps = {
  path: string;
  createModeQuery: string | null;
  collapsed: boolean;
  toolsSubNavExpanded: boolean;
  setToolsSubNavExpanded: Dispatch<SetStateAction<boolean>>;
};

function readCreateModeQuery(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("mode");
  } catch {
    return null;
  }
}

function StudioToolsNavExpanded({
  path,
  createModeQuery,
  collapsed,
  toolsSubNavExpanded,
  setToolsSubNavExpanded
}: StudioToolsNavExpandedProps) {
  const { t } = useI18n();
  const [voiceTab, setVoiceTab] = useState<string | null>(null);

  useEffect(() => {
    setVoiceTab(readVoiceTabQuery());
  }, [path]);

  const voiceManageActive =
    pathMatchesRoot(path, "/voice") && (voiceTab === null || voiceTab === "clone");
  const onCreateRoute = matchesProductStudio(path);
  const createModeNorm = String(createModeQuery || readCreateModeQuery() || "").trim().toLowerCase();
  const podcastStudioActive =
    (onCreateRoute && createModeNorm !== "tts") || pathMatchesRoot(path, "/podcast");
  const ttsStudioActive = onCreateRoute && createModeNorm === "tts";

  const parentTip = t("nav.podcastNav");
  const parentClass = navButtonClass(podcastStudioActive, collapsed);

  const subs: { href: string; label: string; active: boolean }[] = [
    {
      href: "/create?mode=tts",
      label: t("nav.toolTts"),
      active: ttsStudioActive || pathMatchesRoot(path, "/tts")
    },
    { href: "/clip", label: t("create.quickLink.clip"), active: pathMatchesRoot(path, "/clip") },
    { href: "/shownotes", label: t("create.quickLink.shownotes"), active: pathMatchesRoot(path, "/shownotes") },
    { href: "/voice", label: t("create.quickLink.voiceClone"), active: voiceManageActive }
  ];

  if (collapsed) {
    return (
      <SidebarNavLink
        href="/create?mode=podcast"
        className={parentClass}
        title={parentTip}
        aria-current={podcastStudioActive ? "page" : undefined}
      >
        <NavIconBox active={podcastStudioActive}>
          <IconMic />
        </NavIconBox>
      </SidebarNavLink>
    );
  }

  return (
    <div className="flex w-full flex-col gap-0.5">
      <SidebarNavLink
        href="/create?mode=podcast"
        className={parentClass}
        title={parentTip}
        aria-current={podcastStudioActive ? "page" : undefined}
        aria-expanded={toolsSubNavExpanded}
        aria-controls="fym-studio-tools-subnav"
        onClick={() => setToolsSubNavExpanded(true)}
      >
        <NavIconBox active={podcastStudioActive}>
          <IconMic />
        </NavIconBox>
        <span className="min-w-0 flex-1 truncate text-left leading-snug">{t("nav.podcastNav")}</span>
      </SidebarNavLink>
      {toolsSubNavExpanded ? (
        <div
          id="fym-studio-tools-subnav"
          role="group"
          aria-label={t("nav.createSubNavGroup")}
          className="ml-10 flex flex-col gap-0.5"
        >
          {subs.map((s) => (
            <SidebarNavLink
              key={s.href}
              href={s.href}
              className={navCreateSubLinkClass(s.active)}
              title={s.label}
              aria-current={s.active ? "page" : undefined}
            >
              <span className="min-w-0 truncate">{s.label}</span>
            </SidebarNavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StudioToolsNavExpandedWithQuery(
  props: Omit<StudioToolsNavExpandedProps, "createModeQuery">
) {
  const searchParams = useSearchParams();
  const createModeQuery = searchParams?.get("mode") ?? null;
  return <StudioToolsNavExpanded {...props} createModeQuery={createModeQuery} />;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const path = pathname ?? "";
  const { ready, user, getAuthHeaders } = useAuth();
  const loggedIn = isLoggedInAccountUser(user);

  const routePrefetchOpts = useMemo((): PrefetchWorkbenchRouteOptions | undefined => {
    if (!loggedIn || !ready) return undefined;
    return {
      queryClient,
      headers: getAuthHeaders(),
      accountKey: userAccountRef(user)
    };
  }, [loggedIn, ready, queryClient, getAuthHeaders, user]);

  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
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
  const [toolsSubNavExpanded, setToolsSubNavExpanded] = useState(false);
  const [navPending, setNavPending] = useState(false);
  const navPendingTargetRef = useRef<string | null>(null);
  const navPendingHrefRef = useRef<string | null>(null);
  const pathRef = useRef(path);
  const sidebarIdlePrefetchedRef = useRef(false);
  const loginPrefetchDoneRef = useRef(false);
  const navPendingWarmRef = useRef(false);
  const navPendingTierRef = useRef<WorkbenchNavWarmthTier>("cold");

  const clearNavPending = useCallback(() => {
    navPendingTargetRef.current = null;
    navPendingHrefRef.current = null;
    setNavPending(false);
  }, []);

  const dispatchSidebarToggle = useCallback(() => {
    if (typeof window === "undefined") return;
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent(APP_SIDEBAR_TOGGLE_EVENT));
    });
  }, []);

  const beginWorkbenchNav = useCallback(
    (href: string) => {
      const target = normalizePathname(String(href || "").split("?")[0] || href);
      const current = normalizePathname(pathRef.current);
      if (!target || target === current) return;
      const tier = resolveWorkbenchNavWarmthTier(queryClient, target);
      navPendingTierRef.current = tier;
      navPendingWarmRef.current = tier !== "cold";
      navPendingTargetRef.current = target;
      navPendingHrefRef.current = href;
      setNavPending(true);
    },
    [queryClient]
  );

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  useEffect(() => {
    if (!navPending) return;
    const target = navPendingTargetRef.current;
    const current = normalizePathname(path);
    if (target && (current === target || current.startsWith(`${target}/`))) {
      const delay = workbenchNavClearPendingDelayMs(navPendingTierRef.current);
      const timer = window.setTimeout(() => clearNavPending(), delay);
      return () => window.clearTimeout(timer);
    }
  }, [path, navPending, clearNavPending]);

  const navPendingTarget = navPending ? navPendingTargetRef.current : null;
  const navPendingTier: WorkbenchNavWarmthTier | null = navPending ? navPendingTierRef.current : null;
  const showNavPendingOverlay =
    navPending && Boolean(navPendingTarget) && navPendingTier === "cold";
  const showNavPendingProgress =
    navPending && Boolean(navPendingTarget) && !showNavPendingOverlay;
  const sidebarCollapsed = collapsed;

  /** 软路由长时间未切换时整页跳转，避免骨架屏消失后仍停在旧页。 */
  useEffect(() => {
    if (!navPending) return;
    const startedAt = normalizePathname(path);
    const timer = window.setTimeout(() => {
      const target = navPendingTargetRef.current;
      const href = navPendingHrefRef.current;
      const current = normalizePathname(pathRef.current);
      if (!target || !href) return;
      if (current === target || current.startsWith(`${target}/`)) return;
      if (normalizePathname(pathRef.current) !== startedAt) return;
      window.location.assign(href);
    }, workbenchNavHardJumpMs(navPendingTierRef.current));
    return () => window.clearTimeout(timer);
  }, [navPending, path]);

  useEffect(() => {
    if (!navPending) return;
    const timer = window.setTimeout(() => {
      clearNavPending();
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [navPending, clearNavPending]);

  useEffect(() => {
    if (!ready || !loggedIn || loginPrefetchDoneRef.current) return;
    loginPrefetchDoneRef.current = true;
    for (const route of WORKBENCH_LOGIN_PREFETCH_ROUTES) {
      prefetchWorkbenchRoute(router, route, routePrefetchOpts);
    }
    const prefetchSecondary = () => {
      for (const route of WORKBENCH_LOGIN_PREFETCH_ROUTES_SECONDARY) {
        prefetchWorkbenchRoute(router, route, routePrefetchOpts);
      }
    };
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(prefetchSecondary, { timeout: 1500 });
    } else {
      window.setTimeout(prefetchSecondary, 120);
    }
  }, [ready, loggedIn, router, routePrefetchOpts]);

  useEffect(() => {
    if (!ready || isMarketingShellLessPath(path) || sidebarIdlePrefetchedRef.current) return;
    sidebarIdlePrefetchedRef.current = true;
    prefetchWorkbenchSidebarIdle(router, routePrefetchOpts);
  }, [ready, path, router, routePrefetchOpts]);

  const workbenchNavContextValue = useMemo(
    () => ({ navPending, navWarmthTier: navPendingTier, navOverlayVisible: showNavPendingOverlay, beginWorkbenchNav }),
    [navPending, navPendingTier, showNavPendingOverlay, beginWorkbenchNav]
  );

  const navCore = useMemo<NavItem[]>(
    () => [
      { href: WORKBENCH_HOME_PATH, label: t("nav.home"), short: "话", Icon: IconHome },
      {
        href: "/notes",
        label: t("nav.notes"),
        short: t("nav.notesShort"),
        linkTitle: t("nav.notesLinkTitle"),
        Icon: IconNotes,
        activeMatch: (p) => matchesNotesWorkbench(p)
      },
      {
        href: "/works",
        label: t("nav.works"),
        short: "作",
        Icon: IconGrid,
        activeMatch: (p) => pathMatchesRoot(p, "/works") && !matchesWorksTrash(p)
      }
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
    const onRequestCollapse = () => {
      setCollapsed(true);
      dispatchSidebarToggle();
    };
    window.addEventListener(APP_SIDEBAR_COLLAPSE_EVENT, onRequestCollapse);
    return () => window.removeEventListener(APP_SIDEBAR_COLLAPSE_EVENT, onRequestCollapse);
  }, [dispatchSidebarToggle]);

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
    setMobileNavOpen(true);
  }, [closeMobileNav, mobileNavOpen]);

  useEffect(() => {
    closeMobileNav("blur");
    dispatchWorkbenchDismissOverlays();
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    if (matchesWorkbenchTools(path)) setToolsSubNavExpanded(true);
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
      document.documentElement.style.setProperty("--fym-app-sidebar-w", `${SIDEBAR_WIDTH_EXPANDED_PX}px`);
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
    const px = collapsed ? SIDEBAR_WIDTH_COLLAPSED_PX : SIDEBAR_WIDTH_EXPANDED_PX;
    document.documentElement.style.setProperty("--fym-app-sidebar-w", `${px}px`);
    // 不在 cleanup 里 removeProperty：Strict Mode / 依赖重跑时会出现一帧变量缺失，
    // 全屏级 z-index 遮罩会短暂盖住侧栏；无壳场景由上面分支显式清除即可。
  }, [collapsed, ready, path, mobileLayout]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => !c);
    dispatchSidebarToggle();
  }, [dispatchSidebarToggle]);

  const pageShell = (
    <AnimatedPageShell>
      <Suspense key={path} fallback={<WorkbenchRouteSuspenseFallback />}>
        {children}
      </Suspense>
    </AnimatedPageShell>
  );
  const shellChildren = isMarketingShellLessPath(path) ? (
    pageShell
  ) : (
    <ActiveJobsProvider enabled={ready && loggedIn}>
      {pathNeedsWorkAudio(path) ? <WorkAudioShell>{pageShell}</WorkAudioShell> : pageShell}
    </ActiveJobsProvider>
  );

  const workbenchMainContent = !ready ? (
    <>
      <WorkbenchRouteFallback />
      <p className="pb-8 text-center text-xs text-muted">正在加载工作台…</p>
    </>
  ) : (
    shellChildren
  );

  if (!ready && isMarketingShellLessPath(path)) {
    return <div className="relative min-h-screen bg-canvas text-ink">{shellChildren}</div>;
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
   * - 「工作台首页」用原生 a[href]（登录回跳等场景可靠）。
   * - 「知识库」见 NotesNavExpanded（与 CreateStudioNavExpanded 同模式）。
   * - 其余：Next Link 软路由 + hover 预取；离开知识库前 dispatchNotesNavTeardown。
   */
  function renderSidebarNavItem(item: NavItem) {
    const active = linkActive(item);
    const label = sidebarCollapsed && item.short ? item.short : item.label;
    const Ic = item.Icon;
    const tip = item.linkTitle ?? item.label;
    if (item.href === WORKBENCH_HOME_PATH) {
      return (
        <a
          key={item.href}
          href={WORKBENCH_HOME_PATH}
          className={navButtonClass(active, sidebarCollapsed)}
          title={tip}
          onPointerDown={() => {
            dispatchWorkbenchDismissOverlays();
            prefetchWorkbenchRoute(router, WORKBENCH_HOME_PATH, routePrefetchOpts);
            beginWorkbenchNav(WORKBENCH_HOME_PATH);
          }}
        >
          <NavIconBox active={active}>
            <Ic />
          </NavIconBox>
          {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
        </a>
      );
    }
    return (
      <SidebarNavLink
        key={item.href}
        href={item.href}
        prefetchOpts={routePrefetchOpts}
        className={navButtonClass(active, sidebarCollapsed)}
        title={tip}
      >
        <NavIconBox active={active}>
          <Ic />
        </NavIconBox>
        {!sidebarCollapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
      </SidebarNavLink>
    );
  }

  /** 始终挂载完整侧栏：48px 窄轨会隐藏作品/订阅等入口，易被误认为「导航点不动」 */
  const sidebarOffCanvas = mobileLayout && !mobileNavOpen;
  const sidebarDrawerPx = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED_PX : SIDEBAR_WIDTH_EXPANDED_PX;

  const fullSidebarEl = (
    <aside
      ref={sidebarRef}
      id="fym-app-sidebar-root"
      data-fym-app-sidebar
      {...(sidebarOffCanvas ? ({ inert: true } as HTMLAttributes<HTMLElement>) : {})}
      onPointerDownCapture={() => dispatchWorkbenchDismissOverlays()}
      className={[
        `fixed left-0 top-0 ${WORKBENCH_SIDEBAR_Z_CLASS} flex h-svh min-h-0 flex-col border-r border-line bg-surface/95 backdrop-blur-sm`,
        "transition-[width,transform] duration-200 ease-out motion-reduce:transition-none",
        sidebarOffCanvas ? "-translate-x-full pointer-events-none" : "translate-x-0 pointer-events-auto",
        mobileLayout ? "shadow-card" : ""
      ].join(" ")}
      style={{ width: `${sidebarDrawerPx}px` }}
    >
      <div
        className={[
          "flex w-full min-w-0 shrink-0 flex-row flex-nowrap items-center gap-1 px-1.5 py-2",
          sidebarCollapsed ? "justify-center" : "justify-between px-2.5"
        ].join(" ")}
      >
        <SidebarNavLink
          href="/"
          className={[
            "flex min-w-0 shrink-0 items-center rounded-lg p-0.5 outline-offset-2 ring-offset-canvas transition-colors hover:bg-fill/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35",
            sidebarCollapsed ? "justify-center" : ""
          ].join(" ")}
          aria-label={t("nav.brandHomeLink")}
        >
          <BrandGlyph size={sidebarCollapsed ? 28 : 36} />
        </SidebarNavLink>
        <button
          type="button"
          className={[
            "flex shrink-0 items-center justify-center rounded-lg text-muted hover:bg-fill hover:text-ink",
            sidebarCollapsed ? "h-8 w-8" : "h-9 w-9"
          ].join(" ")}
          onClick={toggleCollapsed}
          title={sidebarCollapsed ? t("nav.expand") : t("nav.collapse")}
          aria-label={sidebarCollapsed ? t("nav.expand") : t("nav.collapse")}
        >
          <IconSidebarPanelToggle />
        </button>
      </div>

      <nav
        className="mx-1.5 mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-0.5 py-1 [scrollbar-gutter:stable]"
        aria-label={t("nav.mainNavLabel")}
        onClickCapture={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest("a[href]")) dispatchWorkbenchDismissOverlays();
        }}
        onClick={(e) => {
          if (!mobileLayout || !mobileNavOpen) return;
          const el = e.target as HTMLElement;
          if (el.closest("a, [href]")) closeMobileNav("blur");
        }}
      >
        {navCore
          .filter((item) => item.href !== "/works")
          .map((item) =>
            item.href === "/notes" ? (
              <NotesNavExpanded
                key={item.href}
                item={item}
                path={path}
                collapsed={sidebarCollapsed}
                NavIconBox={NavIconBox}
              />
            ) : (
              renderSidebarNavItem(item)
            )
          )}
        <Suspense
          fallback={
            <StudioToolsNavExpanded
              path={path}
              createModeQuery={readCreateModeQuery()}
              collapsed={sidebarCollapsed}
              toolsSubNavExpanded={toolsSubNavExpanded}
              setToolsSubNavExpanded={setToolsSubNavExpanded}
            />
          }
        >
          <StudioToolsNavExpandedWithQuery
            path={path}
            collapsed={sidebarCollapsed}
            toolsSubNavExpanded={toolsSubNavExpanded}
            setToolsSubNavExpanded={setToolsSubNavExpanded}
          />
        </Suspense>
        {navCore
          .filter((item) => item.href === "/works")
          .map((item) => renderSidebarNavItem(item))}
      </nav>

      <div
        className="shrink-0 space-y-0.5 border-t border-line p-2"
        onClickCapture={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest("a[href]")) dispatchWorkbenchDismissOverlays();
        }}
      >
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

  const sidebarAside = fullSidebarEl;

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
        className={`fixed left-0 top-0 ${WORKBENCH_MOBILE_FAB_Z_CLASS} flex h-12 min-h-[48px] w-12 min-w-[48px] items-center justify-center rounded-br-dawn-lg border-b border-r border-line/80 bg-surface/95 text-ink shadow-soft backdrop-blur-sm transition-colors hover:bg-fill motion-reduce:transition-none`}
        style={{
          paddingTop: "max(0.25rem, env(safe-area-inset-top, 0px))",
          paddingLeft: "max(0.25rem, env(safe-area-inset-left, 0px))"
        }}
        aria-expanded={mobileNavOpen}
        aria-controls="fym-app-sidebar-root"
        title={mobileNavOpen ? t("nav.closeMenu") : t("nav.openMenu")}
        aria-label={mobileNavOpen ? t("nav.closeMenu") : t("nav.openMenu")}
        onClick={() => toggleMobileNav()}
      >
        <MobileMenuGlyph open={mobileNavOpen} />
      </button>
    ) : null;

  return (
    <WorkbenchNavContext.Provider value={workbenchNavContextValue}>
      <WorkbenchNavProgress active={showNavPendingProgress} />
      <div className="relative min-h-screen bg-canvas text-ink">
      <a
        href="#main-content"
        className="absolute left-[-9999px] z-[300] focus:left-4 focus:top-4 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-brand-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        {t("nav.skipToContent")}
      </a>
      {/*
        主导航挂 document.body：与页面内 portal 分离，避免 #__next 子树叠层盖住 fixed 侧栏。
        z-index 取 300000：高于工作台弹层（99990）与页面 portal 菜单，避免遮罩叠层挡住侧栏点击。
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
          "relative flex min-h-screen min-w-0 flex-col",
          mobileLayout ? "pt-[max(3.5rem,calc(2.75rem+env(safe-area-inset-top,0px)))]" : ""
        ].join(" ")}
        style={{ marginLeft: "var(--fym-app-sidebar-w, 232px)" }}
        tabIndex={-1}
      >
        {workbenchMainContent}
        {showNavPendingOverlay ? (
          <div
            className="absolute inset-0 z-[20] bg-canvas/95"
            aria-busy
            aria-live="polite"
            aria-label="页面切换中"
          >
            <WorkbenchRouteFallback />
          </div>
        ) : null}
        {normalizePathname(path) === WORKBENCH_HOME_PATH || showNavPendingOverlay ? null : (
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
    </WorkbenchNavContext.Provider>
  );
}
