import type { ReactNode, SVGProps } from "react";
import { ICON_SIZE_PX, ICON_STROKE, ICON_VIEW_BOX, type IconSize } from "./constants";

export type IconProps = SVGProps<SVGSVGElement> & {
  /** 正方形边长（px）；也可通过 className 用 Tailwind 控制 */
  size?: IconSize;
};

export function iconSvgProps({
  size = 20,
  className,
  ...rest
}: IconProps): SVGProps<SVGSVGElement> {
  const px = ICON_SIZE_PX[size];
  return {
    width: rest.width ?? px,
    height: rest.height ?? px,
    viewBox: ICON_VIEW_BOX,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: ICON_STROKE,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": rest["aria-hidden"] ?? true,
    className,
    ...rest
  };
}

/**
 * 工具层 SVG 根节点：统一视口、描边与默认尺寸。
 * 播放三角等需 fill 的图标在 utility/media 内单独处理。
 */
export function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return <svg {...iconSvgProps({ size, ...rest })}>{children}</svg>;
}
