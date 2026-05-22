import type { SVGProps } from "react";
import { ICON_VIEW_BOX } from "../constants";

type MediaIconProps = SVGProps<SVGSVGElement>;

/** 播放：唯一允许实心的媒体控件 */
export function IconPlayFilled({ className, ...rest }: MediaIconProps) {
  return (
    <svg
      className={className}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={rest["aria-hidden"] ?? true}
      {...rest}
    >
      <path d="M8 5v14l11-7-11-7z" />
    </svg>
  );
}

export function IconPause({ className, ...rest }: MediaIconProps) {
  return (
    <svg
      className={className}
      viewBox={ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden={rest["aria-hidden"] ?? true}
      {...rest}
    >
      <path d="M7 5v14M17 5v14" />
    </svg>
  );
}

/** 停止：实心方块（生成中 / 停止试听） */
export function IconStopFilled({ className, ...rest }: MediaIconProps) {
  return (
    <svg
      className={className}
      viewBox={ICON_VIEW_BOX}
      fill="currentColor"
      aria-hidden={rest["aria-hidden"] ?? true}
      {...rest}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

/** @deprecated 使用 IconPlayFilled */
export const PlayIcon = IconPlayFilled;

/** @deprecated 使用 IconStopFilled */
export const StopIcon = IconStopFilled;
