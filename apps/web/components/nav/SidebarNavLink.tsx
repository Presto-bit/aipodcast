"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { normalizePathname, WORKBENCH_NAV_PREFETCH } from "../../lib/navPaths";
import { prefetchWorkbenchRoute } from "../../lib/navPrefetch";
import { dispatchWorkbenchDismissOverlays } from "../../lib/workbenchOverlays";

type SidebarNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * 侧栏专用 Link：pointerdown 先关遮罩，click 用 router.push 兜底，避免弹层残留时 Next 软路由不切换。
 */
export default function SidebarNavLink({
  href,
  onClick,
  onPointerDown,
  onMouseEnter,
  onFocus,
  ...rest
}: SidebarNavLinkProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const hrefStr = typeof href === "string" ? href : String(href);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const target = normalizePathname(hrefStr.split("?")[0] || hrefStr);
    const current = normalizePathname(pathname);
    if (target === current) return;
    e.preventDefault();
    router.push(hrefStr);
  };

  return (
    <Link
      href={href}
      prefetch={WORKBENCH_NAV_PREFETCH}
      onPointerDown={(e) => {
        dispatchWorkbenchDismissOverlays();
        onPointerDown?.(e);
      }}
      onMouseEnter={(e) => {
        prefetchWorkbenchRoute(router, hrefStr);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        prefetchWorkbenchRoute(router, hrefStr);
        onFocus?.(e);
      }}
      onClick={handleClick}
      {...rest}
    />
  );
}
