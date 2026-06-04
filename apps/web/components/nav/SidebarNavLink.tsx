"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Suspense, type ComponentProps, type MouseEvent } from "react";
import { isLoggedInAccountUser, useAuth, userAccountRef } from "../../lib/auth";
import {
  isSameWorkbenchNavDestination,
  matchesNotesWorkbench,
  normalizePathname,
  parseWorkbenchNavHref,
  WORKBENCH_NAV_PREFETCH
} from "../../lib/navPaths";
import { prefetchWorkbenchRoute, type PrefetchWorkbenchRouteOptions } from "../../lib/navPrefetch";
import { dispatchNotesNavTeardown } from "../../lib/notesLastNotebook";
import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";
import { dispatchWorkbenchDismissOverlays } from "../../lib/workbenchOverlays";

type SidebarNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  prefetchOpts?: PrefetchWorkbenchRouteOptions;
};

/**
 * 侧栏专用导航：pointerdown 预取 chunk + API；软路由点击标记 navPending（保留 fallback）。
 * 离开知识库前先 teardown 弹层/stream，避免阻塞 Next 软路由。
 */
function SidebarNavLinkInner({
  href,
  prefetchOpts: prefetchOptsProp,
  onClick,
  onPointerDown,
  onMouseEnter,
  onFocus,
  children,
  ...rest
}: SidebarNavLinkProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const currentQuery = searchParams?.toString() ?? "";
  const { getAuthHeaders, user, ready } = useAuth();
  const workbenchNav = useWorkbenchNavOptional();
  const hrefStr = typeof href === "string" ? href : String(href);
  const { path: target } = parseWorkbenchNavHref(hrefStr);
  const current = normalizePathname(pathname);
  const sameDestination = isSameWorkbenchNavDestination(hrefStr, pathname, currentQuery);
  const leavingNotes = matchesNotesWorkbench(pathname) && target !== current;
  const loggedIn = isLoggedInAccountUser(user);
  const prefetchOpts =
    prefetchOptsProp ??
    (loggedIn && ready
      ? {
          queryClient,
          headers: getAuthHeaders(),
          accountKey: userAccountRef(user)
        }
      : undefined);

  const runPrefetch = () => {
    prefetchWorkbenchRoute(router, hrefStr, prefetchOpts);
  };

  const handlePointerDown: SidebarNavLinkProps["onPointerDown"] = (e) => {
    if (leavingNotes) {
      dispatchNotesNavTeardown();
    } else {
      dispatchWorkbenchDismissOverlays();
    }
    if (!sameDestination) {
      runPrefetch();
    }
    onPointerDown?.(e);
  };

  const handleMouseEnter: SidebarNavLinkProps["onMouseEnter"] = (e) => {
    runPrefetch();
    onMouseEnter?.(e);
  };

  const handleFocus: SidebarNavLinkProps["onFocus"] = (e) => {
    runPrefetch();
    onFocus?.(e);
  };

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (sameDestination) {
      e.preventDefault();
      return;
    }
    if (target === current) {
      e.preventDefault();
      router.push(hrefStr, { scroll: false });
      return;
    }
    workbenchNav?.beginWorkbenchNav(hrefStr);
  };

  return (
    <Link
      href={href}
      prefetch={WORKBENCH_NAV_PREFETCH}
      onPointerDown={handlePointerDown}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** useSearchParams 须处于 Suspense 内，避免生产构建静态页 prerender 失败。 */
export default function SidebarNavLink(props: SidebarNavLinkProps) {
  const { children, ...rest } = props;
  return (
    <Suspense
      fallback={
        <Link prefetch={WORKBENCH_NAV_PREFETCH} {...rest}>
          {children}
        </Link>
      }
    >
      <SidebarNavLinkInner {...props} />
    </Suspense>
  );
}
