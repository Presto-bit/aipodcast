import type { SVGProps } from "react";
import { iconSvgProps, type IconProps } from "../Icon";

export type AdminNavIconId = "users" | "models" | "usage" | "jobs" | "works" | "polish" | "matrix" | "pay" | "logs";

export function AdminNavIcon({
  icon,
  active,
  className
}: {
  icon: AdminNavIconId;
  active: boolean;
  className?: string;
}) {
  const colorClass = active ? "text-brand" : "text-muted";
  const svgClass = `h-4 w-4 ${colorClass} ${className ?? ""}`.trim();

  if (icon === "users") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <path d="M16 19v-1a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v1" />
        <circle cx="10.5" cy="11" r="3" />
        <path d="M17 16a2.5 2.5 0 1 0 0-5" />
        <path d="M19 19v-1a3 3 0 0 0-2-2.83" />
      </svg>
    );
  }
  if (icon === "models") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <path d="M4 7.5 12 4l8 3.5-8 3.5L4 7.5z" />
        <path d="M4 11.5 12 15l8-3.5-8-3.5L4 11.5z" />
        <path d="M4 15.5 12 19l8-3.5-8-3.5L4 15.5z" />
      </svg>
    );
  }
  if (icon === "usage") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <path d="M4 19h16" />
        <path d="M7 16v-3M12 16V8M17 16v-5" />
      </svg>
    );
  }
  if (icon === "works") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <path d="M12 3v18" />
        <path d="M8 8h8M8 16h8" />
        <path d="M5 6h2v12H5V6zM17 6h2v12h-2V6z" />
      </svg>
    );
  }
  if (icon === "polish") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <path d="M4 20 11.5 12.5" />
        <path d="M5 11 13 3l3 3-8 8-3 1 2-3.5z" />
        <path d="M14 9l2 2M15 12l3 3M6 18h12" />
      </svg>
    );
  }
  if (icon === "matrix") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <rect x="4" y="6" width="4" height="4" />
        <rect x="10" y="6" width="10" height="4" />
        <rect x="4" y="14" width="4" height="4" />
        <rect x="10" y="14" width="10" height="4" />
      </svg>
    );
  }
  if (icon === "pay") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <rect x="4" y="7" width="16" height="10" rx="2" />
        <path d="M4 10h16" />
      </svg>
    );
  }
  if (icon === "logs") {
    return (
      <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
        <path d="M5 5h14M5 9h10M5 13h14M5 17h8" />
        <path d="M17 16v4M15 18h4" />
      </svg>
    );
  }
  return (
    <svg {...iconSvgProps({ className: svgClass, size: 16 })}>
      <path d="M3 8h18M7 4h10M6 12h12M10 16h4M6 20h12" />
    </svg>
  );
}

export type { SVGProps };
