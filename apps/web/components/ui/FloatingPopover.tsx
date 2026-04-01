"use client";

import { autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react";
import { createPortal } from "react-dom";
import { useEffect, type MouseEventHandler, type ReactNode } from "react";

export type FloatingPopoverProps = {
  open: boolean;
  anchorEl: HTMLElement | null;
  isMobile: boolean;
  mobileClassName: string;
  desktopClassName: string;
  ariaLabel: string;
  children: ReactNode;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
};

export default function FloatingPopover({
  open,
  anchorEl,
  isMobile,
  mobileClassName,
  desktopClassName,
  ariaLabel,
  children,
  onMouseDown
}: FloatingPopoverProps) {
  const { refs, floatingStyles, update } = useFloating({
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ["top-start", "bottom-start"] }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          const nextMaxHeight = Math.max(220, Math.floor(availableHeight));
          elements.floating.style.maxHeight = `${nextMaxHeight}px`;
        }
      })
    ]
  });

  useEffect(() => {
    if (!open || isMobile) return;
    refs.setReference(anchorEl);
    void update();
  }, [anchorEl, isMobile, open, refs, update]);

  if (!open) return null;

  if (isMobile || typeof document === "undefined") {
    return (
      <div data-floating-panel data-podcast-panel className={mobileClassName} onMouseDown={onMouseDown} role="dialog" aria-label={ariaLabel}>
        {children}
      </div>
    );
  }

  return createPortal(
    <div
      ref={refs.setFloating}
      data-floating-panel
      data-podcast-panel
      className={desktopClassName}
      style={floatingStyles}
      onMouseDown={onMouseDown}
      role="dialog"
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body
  );
}
