"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { WORKBENCH_LINK_PREFETCH, prefetchWorkbenchRoute } from "../../lib/navPrefetch";

type WorkbenchLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  href: string;
};

/** 工作台侧栏/导航 Link：默认不 prefetch，hover/focus 时再预取目标路由。 */
export default function WorkbenchLink({ href, onMouseEnter, onFocus, ...rest }: WorkbenchLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={href}
      prefetch={WORKBENCH_LINK_PREFETCH}
      onMouseEnter={(e) => {
        prefetchWorkbenchRoute(router, href);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        prefetchWorkbenchRoute(router, href);
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
