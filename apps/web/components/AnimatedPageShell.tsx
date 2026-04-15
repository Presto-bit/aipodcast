"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * 路由切换时不再用 key=pathname 强制外层 remount（会加重卡顿），仅重放入场动画类。
 */
export default function AnimatedPageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shellRef = useRef<HTMLDivElement>(null);
  const isFirstPathEffect = useRef(true);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (isFirstPathEffect.current) {
      isFirstPathEffect.current = false;
      return;
    }
    el.classList.remove("fym-page-enter");
    void el.offsetWidth;
    el.classList.add("fym-page-enter");
  }, [pathname]);

  return (
    <div ref={shellRef} className="fym-page-enter fym-page-shell">
      {children}
    </div>
  );
}
