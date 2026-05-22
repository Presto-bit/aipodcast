import type { SVGProps } from "react";
import { ICON_STROKE, ICON_VIEW_BOX } from "../constants";

type BrandIconProps = SVGProps<SVGSVGElement>;

function brandSvg(props: BrandIconProps) {
  return {
    width: props.width ?? 20,
    height: props.height ?? 20,
    viewBox: ICON_VIEW_BOX,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: ICON_STROKE,
    "aria-hidden": props["aria-hidden"] ?? true,
    ...props
  };
}

/** 侧栏导航：形态互相区分，避免多枚「折角文档 / 麦克风」撞车 */
export function IconHome(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M4 10.5 12 4l8 6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v10h4v-6h4v6h4V10" strokeLinejoin="round" />
    </svg>
  );
}

export function IconNotes(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M7 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M9 3v18" strokeLinecap="round" opacity={0.4} />
      <path d="M12 13h4M12 16.5h3" strokeLinecap="round" />
    </svg>
  );
}

/** AI 播客：不对称声波 + 拾音 */
export function IconMic(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M8 14a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M12 18v3" strokeLinecap="round" />
      <path d="M9.5 21h5" strokeLinecap="round" />
      <path d="M10 10V8a2 2 0 1 1 4 0v2" strokeLinejoin="round" />
      <path d="M17 7v2c0 2-1.5 3.5-3.5 3.5" strokeLinecap="round" />
      <path d="M7 9v1c0 1.6 1 2.8 2.3 3.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCreate(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <circle cx="12" cy="12" r="9" strokeLinejoin="round" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

export function IconTts(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M4 7h8M4 10.5h6M4 14h7" strokeLinecap="round" />
      <path d="M15 8v8l3.5-2.5V10.5L15 8z" strokeLinejoin="round" />
      <path d="M19.5 9.5a3 3 0 0 1 0 5" strokeLinecap="round" />
    </svg>
  );
}

export function IconVoice(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M6 18V11" strokeLinecap="round" />
      <path d="M10 18V6" strokeLinecap="round" />
      <path d="M14 18v-7" strokeLinecap="round" />
      <path d="M18 18V9" strokeLinecap="round" />
      <path d="M4.5 18.5h15" strokeLinecap="round" opacity={0.4} />
    </svg>
  );
}

export function IconGrid(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="4" y="4" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="13" y="4" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="4" y="13" width="7" height="7" rx="1" strokeLinejoin="round" />
      <path d="M14.5 15.5l3.5 2.2v-4.4l-3.5 2.2z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDraft(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M9 3h6l1 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l1-2z" strokeLinejoin="round" />
      <path d="M9 10.5l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 17h6" strokeLinecap="round" />
    </svg>
  );
}

export function IconUser(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <circle cx="12" cy="8" r="3.5" strokeLinejoin="round" />
      <path d="M6.5 20.5v-1c0-2.5 2-4.5 5.5-4.5s5.5 2 5.5 4.5v1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSubscription(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="2" y="6" width="20" height="12" rx="2" strokeLinejoin="round" />
      <path d="M2 10h20" strokeLinecap="round" />
      <path d="M7 14h4" strokeLinecap="round" />
      <path d="M16 12.5v3M14.5 14h3" strokeLinecap="round" />
    </svg>
  );
}

export function IconShownotes(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M7 7h10M7 12h7M7 17h10" strokeLinecap="round" />
      <path d="M17 10v4l3-2-3-2z" strokeLinejoin="round" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 文稿剪辑：胶片孔 + 斜向剪口 */
export function IconClip(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="4" y="6.5" width="16" height="11" rx="1.5" strokeLinejoin="round" />
      <path d="M7 6.5v-2M10 6.5v-2M13 6.5v-2M16 6.5v-2" strokeLinecap="round" opacity={0.45} />
      <path d="M4 12h16" strokeLinecap="round" opacity={0.22} />
      <path d="M12 10.5l-2.2 5M12 10.5l2.2 5" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 作品占位：播客（紧凑麦 + 声波） */
export function IconWorkPodcast(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="10" y="4" width="4" height="7" rx="2" strokeLinejoin="round" />
      <path d="M8 11a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M12 15v2" strokeLinecap="round" />
      <path d="M16 8.5c1.5 1.2 2.5 3 2.5 5" strokeLinecap="round" opacity={0.55} />
      <path d="M8 9.5c-1.2 1-2 2.6-2 4.5" strokeLinecap="round" opacity={0.55} />
    </svg>
  );
}

/** 作品占位：文稿（折页 + 横线） */
export function IconWorkScript(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M8 4h7l3 3v13H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M15 4v3h3" strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
      <path d="M10 11h6M10 14.5h5M10 18h4" strokeLinecap="round" />
    </svg>
  );
}

export function WorkTypeIcon({
  scriptDraft,
  className,
  size = 20
}: {
  scriptDraft: boolean;
  className?: string;
  size?: number;
}) {
  const px = size;
  const shared = { width: px, height: px, className };
  return scriptDraft ? <IconWorkScript {...shared} /> : <IconWorkPodcast {...shared} />;
}
