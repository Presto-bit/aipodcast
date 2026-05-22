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

/**
 * 品牌图标（FY 播客系）：圆角几何 + opacity 副笔画 + 少量实心点缀。
 * 侧栏、首页卡片、创作入口、作品占位、剪辑侧栏均使用同一套造型语言。
 */
export function IconHome(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M5 11.5 12 6l7 5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 11.5V18h9v-6.5" strokeLinejoin="round" />
      <path d="M9 15.5h1.8M11.2 14.2h1.6M13.8 15.8h1.6M16 14.5h1.5" strokeLinecap="round" opacity={0.55} />
    </svg>
  );
}

/** 知识库：书签 + 资料页 */
export function IconNotes(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path
        d="M7 8.5h10a2 2 0 0 1 2 2v7.5a1.5 1.5 0 0 1-1.5 1.5H8.5A1.5 1.5 0 0 1 7 18V8.5z"
        strokeLinejoin="round"
      />
      <path d="M10.5 6.5v2.2a1.8 1.8 0 0 0 3.6 0V6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 13h6M10 16h4.5" strokeLinecap="round" />
      <path d="M7 12.5h12" strokeLinecap="round" opacity={0.32} />
    </svg>
  );
}

/** AI 播客：圆角工作台 + 麦克风 + 不对称声波 */
export function IconMic(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="5" y="5" width="14" height="14" rx="3.5" opacity={0.28} />
      <rect x="10.5" y="7.5" width="3" height="6" rx="1.5" strokeLinejoin="round" />
      <path d="M8.5 13.5a3.5 3.5 0 0 0 7 0" strokeLinecap="round" />
      <path d="M12 13.5v2" strokeLinecap="round" />
      <path d="M16.5 10.2c1 1.1 1.5 2.6 1.4 4" strokeLinecap="round" opacity={0.5} />
      <path d="M7.5 10.8c-1 1-1.5 2.4-1.4 3.8" strokeLinecap="round" opacity={0.5} />
      <circle cx="12" cy="6.8" r="0.9" fill="currentColor" stroke="none" opacity={0.72} />
    </svg>
  );
}

/** 创作：圆角工作台 + 笔触与星点 */
export function IconCreate(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="5" y="5" width="14" height="14" rx="3.5" strokeLinejoin="round" />
      <path d="M15.5 7.5 9 17" strokeLinecap="round" />
      <path d="M13.5 7.5 9 12" strokeLinecap="round" opacity={0.45} />
      <circle cx="16.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" opacity={0.75} />
    </svg>
  );
}

/** 文本转语音：文稿块 + 实心喇叭 */
export function IconTts(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="4" y="6" width="10" height="12" rx="2" strokeLinejoin="round" />
      <path d="M7 10h5M7 12.5h4M7 15h5" strokeLinecap="round" />
      <path d="M15.5 9.5v5l3.2-2.4v-5l-3.2 2.4z" fill="currentColor" stroke="none" opacity={0.88} />
      <path d="M20 11.2a2.6 2.6 0 0 1 0 1.6" strokeLinecap="round" opacity={0.45} />
    </svg>
  );
}

/** 音色库：圆角托盘 + 均衡器 */
export function IconVoice(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="4" y="5" width="16" height="14" rx="3" strokeLinejoin="round" opacity={0.3} />
      <path d="M7 17V12M10.5 17V8M14 17v-5M17.5 17V10" strokeLinecap="round" />
      <path d="M5.5 17.5h13" strokeLinecap="round" opacity={0.38} />
    </svg>
  );
}

/** 我的作品：四宫格 + 播放角标 */
export function IconGrid(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="4" y="4" width="7" height="7" rx="2" strokeLinejoin="round" />
      <rect x="13" y="4" width="7" height="7" rx="2" strokeLinejoin="round" />
      <rect x="4" y="13" width="7" height="7" rx="2" strokeLinejoin="round" />
      <rect x="13" y="13" width="7" height="7" rx="2" strokeLinejoin="round" opacity={0.38} />
      <path d="M15.2 16.2l3.2 2v-4l-3.2 2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 草稿：叠页 + 勾选 */
export function IconDraft(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path
        d="M8.5 7h8.5l1.8 1.8v10.2a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V7z"
        strokeLinejoin="round"
        opacity={0.42}
      />
      <path d="M6.5 8.5h8.5l1.8 1.8v9.7a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5V8.5z" strokeLinejoin="round" />
      <path d="M9.5 13.5 11.5 15.5 15 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 18h5.5" strokeLinecap="round" opacity={0.45} />
    </svg>
  );
}

/** 我的：圆环头像 */
export function IconUser(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <circle cx="12" cy="12" r="8.5" opacity={0.28} />
      <circle cx="12" cy="9.5" r="3" strokeLinejoin="round" />
      <path d="M6.5 18.5c.9-2.1 2.9-3.5 5.5-3.5s4.6 1.4 5.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 订阅：会员卡 + 星标 */
export function IconSubscription(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="3" y="7" width="18" height="11" rx="2.5" strokeLinejoin="round" />
      <path d="M3 10.5h18" strokeLinecap="round" opacity={0.38} />
      <path d="M6.5 14.5h4.5" strokeLinecap="round" />
      <path
        d="M16.2 11.8l.75 1.55 1.7.25-1.23 1.2.3 1.68-1.52-.8-1.52.8.3-1.68-1.23-1.2 1.7-.25.75-1.55z"
        fill="currentColor"
        stroke="none"
        opacity={0.9}
      />
    </svg>
  );
}

/** Shownotes：节目单卡片 + 播放 */
export function IconShownotes(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="5" y="5" width="14" height="14" rx="2.5" strokeLinejoin="round" />
      <path d="M8 9h5.5M8 12h4M8 15h5.5" strokeLinecap="round" />
      <path d="M16 11.5v3l2.2-1.5-2.2-1.5z" fill="currentColor" stroke="none" />
      <path d="M5 12.2h14" strokeLinecap="round" opacity={0.22} />
    </svg>
  );
}

/** 文稿剪辑：圆角胶片 + 剪切口 */
export function IconClip(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <rect x="4" y="7" width="16" height="10" rx="2" strokeLinejoin="round" />
      <path d="M6.5 7v-1.8M9.5 7v-1.8M12.5 7v-1.8M15.5 7v-1.8" strokeLinecap="round" opacity={0.4} />
      <path d="M4 12h16" strokeLinecap="round" opacity={0.25} />
      <path d="M12 10.2l-2 4.6M12 10.2l2 4.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" opacity={0.55} />
    </svg>
  );
}

/** 回收站：现代桶形 */
export function IconTrash(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path d="M5 8.5h14" strokeLinecap="round" />
      <path d="M9 8.5V7a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 7v1.5" strokeLinecap="round" />
      <path
        d="M7.8 8.5l.9 10.2a1.5 1.5 0 0 0 1.5 1.3h5.6a1.5 1.5 0 0 0 1.5-1.3l.9-10.2"
        strokeLinejoin="round"
      />
      <path d="M10 11.5v5.5M14 11.5v5.5" strokeLinecap="round" opacity={0.5} />
    </svg>
  );
}

/** 作品占位：播客（与 IconMic 同系，更紧凑） */
export function IconWorkPodcast(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <circle cx="12" cy="12" r="8" opacity={0.22} />
      <rect x="10.5" y="8" width="3" height="5.5" rx="1.5" strokeLinejoin="round" />
      <path d="M9 13.2a3 3 0 0 0 6 0" strokeLinecap="round" />
      <path d="M15.2 10.5c.8.9 1.2 2 1.1 3" strokeLinecap="round" opacity={0.5} />
      <path d="M8.8 11c-.7.8-1.1 1.9-1 3" strokeLinecap="round" opacity={0.5} />
    </svg>
  );
}

/** 作品占位：文稿（与草稿/笔记同系叠页） */
export function IconWorkScript(props: BrandIconProps) {
  return (
    <svg {...brandSvg(props)}>
      <path
        d="M9 5.5h6.5l2 2v11H9a1.5 1.5 0 0 1-1.5-1.5V5.5z"
        strokeLinejoin="round"
        opacity={0.38}
      />
      <path d="M7.5 7h6.5l2 2v9.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V7z" strokeLinejoin="round" />
      <path d="M9.5 12h5M9.5 14.8h4M9.5 17.2h3" strokeLinecap="round" />
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
