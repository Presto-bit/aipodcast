"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { matchesNotesWorkbench, normalizePathname, WORKBENCH_NAV_PREFETCH } from "../../lib/navPaths";
import { prefetchWorkbenchRoute } from "../../lib/navPrefetch";
import { dispatchWorkbenchDismissOverlays } from "../../lib/workbenchOverlays";

type SidebarNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * 侧栏专用 Link：pointerdown 先关遮罩。
 * 知识库页卸载前会阻塞 Next 软路由，离开 /notes 时用整页跳转。
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

    if (matchesNotesWorkbench(pathname)) {
      e.preventDefault();
      window.location.assign(hrefStr);
    }
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
