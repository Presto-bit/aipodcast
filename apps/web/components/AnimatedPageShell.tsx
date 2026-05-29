"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useWorkbenchNavOptional } from "../lib/WorkbenchNavContext";

/**
 * 路由切换时不再用 key=pathname 强制外层 remount（会加重卡顿），仅重放入场动画类。
 * 动画类更新放在连续 requestAnimationFrame 中，避免与切页 commit 同帧抢布局。
 */
export default function AnimatedPageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navPending = useWorkbenchNavOptional()?.navPending ?? false;
  const shellRef = useRef<HTMLDivElement>(null);
  const isFirstPathEffect = useRef(true);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (isFirstPathEffect.current) {
      isFirstPathEffect.current = false;
      return;
    }
    if (navPending) return;
    /** 延后到下一帧再触发动画重启，避免与 Next 切页 commit 抢同一帧布局（减轻卡顿感）。 */
    let raf0 = 0;
    let raf1 = 0;
    raf0 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        el.classList.remove("fym-page-enter");
        void el.offsetWidth;
        el.classList.add("fym-page-enter");
      });
    });
    return () => {
      cancelAnimationFrame(raf0);
      cancelAnimationFrame(raf1);
    };
  }, [pathname, navPending]);

  return (
    <div
      ref={shellRef}
      className={[
        "fym-page-enter fym-page-shell min-w-0",
        navPending ? "pointer-events-none invisible opacity-0" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-nav-pending={navPending || undefined}
      aria-hidden={navPending || undefined}
    >
      {children}
    </div>
  );
}
