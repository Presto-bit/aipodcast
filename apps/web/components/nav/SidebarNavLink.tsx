"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { matchesNotesWorkbench, normalizePathname, WORKBENCH_NAV_PREFETCH } from "../../lib/navPaths";
import { prefetchWorkbenchRoute } from "../../lib/navPrefetch";
import { dispatchWorkbenchDismissOverlays } from "../../lib/workbenchOverlays";

type SidebarNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * 侧栏专用导航：pointerdown 先关遮罩。
 * 在知识库工作台时渲染原生 `<a>` 整页跳转——NotesPageMain 会阻塞 Next 软路由。
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
  const hrefStr = typeof href === "string" ? href : String(href);
  const target = normalizePathname(hrefStr.split("?")[0] || hrefStr);
  const current = normalizePathname(pathname);
  const useNativeAnchor = matchesNotesWorkbench(pathname) && target !== current;

  const handlePointerDown: SidebarNavLinkProps["onPointerDown"] = (e) => {
    dispatchWorkbenchDismissOverlays();
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
      onClick={onClick}
      {...rest}
    >
      {children}
    </Link>
  );
}
