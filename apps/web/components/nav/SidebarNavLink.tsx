"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { normalizePathname, WORKBENCH_NAV_PREFETCH } from "../../lib/navPaths";
import { prefetchWorkbenchRoute } from "../../lib/navPrefetch";
import { useWorkbenchNavOptional } from "../../lib/WorkbenchNavContext";
import { dispatchWorkbenchDismissOverlays } from "../../lib/workbenchOverlays";

type SidebarNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * 侧栏专用导航：pointerdown 先关遮罩；软路由点击即标记 navPending（有 warm cache 时由 AppShell 跳过 overlay）。
 */
export default function SidebarNavLink({
  href,
  onClick,
  onPointerDown,
  onMouseEnter,
  onFocus,
  children,
  ...rest
}: SidebarNavLinkProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const workbenchNav = useWorkbenchNavOptional();
  const hrefStr = typeof href === "string" ? href : String(href);
  const target = normalizePathname(hrefStr.split("?")[0] || hrefStr);
  const current = normalizePathname(pathname);

  const handlePointerDown: SidebarNavLinkProps["onPointerDown"] = (e) => {
    dispatchWorkbenchDismissOverlays();
    if (target !== current) {
      prefetchWorkbenchRoute(router, hrefStr);
    }
    onPointerDown?.(e);
  };

  const handleMouseEnter: SidebarNavLinkProps["onMouseEnter"] = (e) => {
    prefetchWorkbenchRoute(router, hrefStr);
    onMouseEnter?.(e);
  };

  const handleFocus: SidebarNavLinkProps["onFocus"] = (e) => {
    prefetchWorkbenchRoute(router, hrefStr);
    onFocus?.(e);
  };

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (target === current) return;
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
