"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type ReactNode } from "react";

const EST_ROW = 102;

type Props = {
  itemsLength: number;
  children: (index: number) => ReactNode;
  /** 列表滚动时回调（例如关闭挂在 body 上的行内菜单，避免错位） */
  onScroll?: () => void;
};

/**
 * 仅渲染可视区域的系统音色行，避免数百条 DOM 同时挂载。
 */
export default function SystemVoicesVirtualList({ itemsLength, children, onScroll }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: itemsLength,
    getScrollElement: () => parentRef.current,
    estimateSize: () => EST_ROW,
    overscan: 10
  });

  if (itemsLength === 0) return null;

  const vi = virtualizer.getVirtualItems();
  return (
    <div
      ref={parentRef}
      className="mt-4 max-h-[min(70vh,560px)] overflow-auto rounded-xl border border-line/70 bg-fill/15"
      onScroll={onScroll}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {vi.map((row) => (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            className="absolute left-0 top-0 w-full px-0 py-1"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {children(row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
