"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ComponentProps, MouseEvent } from "react";
import { isLoggedInAccountUser, useAuth, userAccountRef } from "../../lib/auth";
import { matchesNotesWorkbench, normalizePathname, WORKBENCH_NAV_PREFETCH } from "../../lib/navPaths";
import { prefetchWorkbenchRoute, type PrefetchWorkbenchRouteOptions } from "../../lib/navPrefetch";
import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";
import { dispatchWorkbenchDismissOverlays } from "../../lib/workbenchOverlays";

type SidebarNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  prefetchOpts?: PrefetchWorkbenchRouteOptions;
};

/**
 * 侧栏专用导航：pointerdown 先关遮罩并预取 chunk + API；软路由点击即标记 navPending。
 * 离开知识库工作台时用原生 `<a>` 整页跳转——NotesPageMain 会阻塞 Next 软路由。
 */
export default function SidebarNavLink({
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
  const { getAuthHeaders, user, ready } = useAuth();
  const workbenchNav = useWorkbenchNavOptional();
  const hrefStr = typeof href === "string" ? href : String(href);
  const target = normalizePathname(hrefStr.split("?")[0] || hrefStr);
  const current = normalizePathname(pathname);
  const useNativeAnchor = matchesNotesWorkbench(pathname) && target !== current;
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
    dispatchWorkbenchDismissOverlays();
    if (target !== current) {
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
    if (target === current) return;
    if (!useNativeAnchor) {
      workbenchNav?.beginWorkbenchNav(hrefStr);
    }
  };

  if (useNativeAnchor) {
    return (
      <a
        href={hrefStr}
        onPointerDown={handlePointerDown}
        onMouseEnter={handleMouseEnter}
        onFocus={handleFocus}
        onClick={onClick}
        {...rest}
      >
        {children}
      </a>
    );
  }

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
