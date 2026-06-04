import type { SVGProps } from "react";
import { ICON_STROKE, ICON_VIEW_BOX } from "../constants";

type ChromeIconProps = SVGProps<SVGSVGElement>;

function chromeSvg(props: ChromeIconProps, strokeWidth = ICON_STROKE) {
  return {
    viewBox: ICON_VIEW_BOX,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    "aria-hidden": props["aria-hidden"] ?? true,
    ...props
  };
}

export function IconSidebarPanelToggle({ className }: { className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5.5 2.5v11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconChevronSidebar({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <svg width={18} height={18} className={className} {...chromeSvg({})}>
      {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
    </svg>
  );
}

export function IconMenu({ open, className }: { open: boolean; className?: string }) {
  if (open) {
    return (
      <svg width={22} height={22} className={className} {...chromeSvg({}, 2.2)}>
        <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
      </svg>
    );
  }
  return (
    <svg width={22} height={22} className={className} {...chromeSvg({})}>
      <path strokeLinecap="round" d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}
