"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const DEFAULT_ROW_HEIGHT = 44;

/** 表格虚拟滚动：滚动容器内 thead sticky，tbody 用 padding 占位。 */
export function useTableVirtualizer(rowCount: number, rowHeight = DEFAULT_ROW_HEIGHT, enabled = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = enabled && rowCount > 0;
  const virtualizer = useVirtualizer({
    count: active ? rowCount : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10
  });

  const items = active ? virtualizer.getVirtualItems() : [];
  const padTop = items.length > 0 ? items[0]!.start : 0;
  const padBottom = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1]!.end : 0;

  return {
    scrollRef,
    virtualizer,
    virtualItems: items,
    padTop,
    padBottom,
    useVirtual: active && rowCount >= 20
  };
}
