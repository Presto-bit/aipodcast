import type { ReactNode } from "react";
import { iconSvgProps, type IconProps } from "../Icon";

function U({ children, ...props }: IconProps & { children: ReactNode }) {
  return <svg {...iconSvgProps(props)}>{children}</svg>;
}

export function IconX(props: IconProps) {
  return (
    <U {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </U>
  );
}

export function IconStar(props: IconProps & { filled?: boolean }) {
  const { filled, ...rest } = props;
  return (
    <svg
      {...iconSvgProps(rest)}
      fill={filled ? "currentColor" : "none"}
    >
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDotsHorizontal(props: IconProps) {
  return (
    <svg {...iconSvgProps(props)} fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <U {...props}>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
    </U>
  );
}

export function IconShareNodes(props: IconProps) {
  return (
    <U {...props}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 13.6 14.8 16.8M15.2 7.2 9.2 10.4" />
    </U>
  );
}

export function IconFilePlus(props: IconProps) {
  return (
    <U {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinejoin="round" />
      <path d="M12 18v-6M9 15h6" />
    </U>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...iconSvgProps(props)} fill="currentColor" stroke="none">
      <path d="M12 2l1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2L12 2z" opacity={0.88} />
      <path d="M19 14l.6 2.4L22 17l-2.4.6L19 20l-.6-2.4L16 17l2.4-.6L19 14z" opacity={0.5} />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <U {...props}>
      <path d="M5 12h14M13 8l6 6-6 6" />
    </U>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <U {...props}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </U>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <U {...props}>
      <path d="M6 9l6 6 6-6" />
    </U>
  );
}

export function IconChevronUp(props: IconProps) {
  return (
    <U {...props}>
      <path d="M18 15l-6-6-6 6" />
    </U>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <U {...props}>
      <path d="M15 18l-6-6 6-6" />
    </U>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <U {...props}>
      <path d="M9 18l6-6-6-6" />
    </U>
  );
}

export function IconRotateCw(props: IconProps) {
  return (
    <U {...props}>
      <path d="M4 9a8 8 0 0 1 13.657-5.657M20 15a8 8 0 0 1-13.657 5.657" />
      <path d="M20 15v-4M4 9v4" />
    </U>
  );
}

export function IconVolume(props: IconProps) {
  return (
    <U {...props}>
      <path d="M11 5 6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11" />
    </U>
  );
}

/** 音色页：克隆 */
export function IconVoiceCloneTab(props: IconProps) {
  return (
    <U {...props}>
      <rect x="9" y="3" width="6" height="9" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3" />
    </U>
  );
}

/** 音色页：库 */
export function IconVoiceLibraryTab(props: IconProps) {
  return (
    <U {...props}>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </U>
  );
}

/** 音色页：人设 */
export function IconVoicePersonaTab(props: IconProps) {
  return (
    <U {...props}>
      <path d="M4 5h16M4 12h10M4 19h14" />
      <path d="M18 10v4M16 12h4" />
    </U>
  );
}

/** 参考资料侧栏：装订册 */
export function IconSourcesBinder(props: IconProps) {
  return (
    <U {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </U>
  );
}

/** 停止生成（实心方块，与 IconStopFilled 同形，尺寸可变） */
export function IconStopSquare(props: IconProps) {
  return (
    <svg {...iconSvgProps(props)} fill="currentColor" stroke="none">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}
