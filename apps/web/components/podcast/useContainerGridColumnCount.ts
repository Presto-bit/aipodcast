"use client";

import { useEffect, useState, type RefObject } from "react";

type Options = {
  enabled: boolean;
  minItemWidth: number;
  gap: number;
  maxCols?: number;
};

/**
 * 根据容器宽度计算网格列数（侧栏迷你卡等窄容器场景）。
 */
export function useContainerGridColumnCount(
  ref: RefObject<HTMLElement | null>,
  { enabled, minItemWidth, gap, maxCols = 4 }: Options
): number {
  const [cols, setCols] = useState(1);

  useEffect(() => {
    if (!enabled) {
      setCols(1);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) {
        setCols(1);
        return;
      }
      const next = Math.max(1, Math.floor((w + gap) / (minItemWidth + gap)));
      setCols(Math.min(next, maxCols));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, enabled, minItemWidth, gap, maxCols]);

  return cols;
}
