"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { PodcastWorkRow } from "./workGalleryListShared";
import type { WorkGalleryActivePlayback } from "./workGalleryListContext";
import { WorkGalleryListItem } from "./WorkGalleryListItem";

const GAP_PX = 10;
const EST_ROW_DEFAULT = 392 + GAP_PX;
const EST_ROW_ALL_VARIANT = 432 + GAP_PX;

type Props = {
  items: PodcastWorkRow[];
  columnCount: number;
  variant: "podcast" | "tts" | "notes" | "notes_studio" | "all";
  eagerCoverFirstCount: number;
  activeJobId?: string | null;
  activePlayback?: WorkGalleryActivePlayback | null;
};

export function WorkGalleryVirtualGrid({
  items,
  columnCount,
  variant,
  eagerCoverFirstCount,
  activeJobId = null,
  activePlayback = null
}: Props) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rowCount = Math.max(0, Math.ceil(items.length / Math.max(1, columnCount)));

  useLayoutEffect(() => {
    const el = anchorRef.current;
    const update = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setScrollMargin(r.top + window.scrollY);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [items.length, columnCount]);

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => (variant === "all" ? EST_ROW_ALL_VARIANT : EST_ROW_DEFAULT),
    overscan: 2,
    scrollMargin
  });

  const cols = Math.max(1, columnCount);

  return (
    <>
      <div ref={anchorRef} className="h-px w-full" aria-hidden />
      <div className="relative w-full" style={{ minHeight: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((vRow) => {
          const start = vRow.index * cols;
          const slice = items.slice(start, start + cols);
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-2.5"
              style={{
                transform: `translateY(${vRow.start}px)`
              }}
            >
              <div
                className="grid w-full gap-2.5"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {slice.map((w, col) => {
                  const gi = start + col;
                  return (
                    <div key={String(w.id)} className="min-w-0" role="listitem">
                      <WorkGalleryListItem
                        w={w}
                        index={gi}
                        outer="div"
                        eagerCoverFirstCount={eagerCoverFirstCount}
                        useListCoverThumb
                        suppressContainerRole
                        activePlayback={activeJobId === String(w.id) ? activePlayback : null}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
