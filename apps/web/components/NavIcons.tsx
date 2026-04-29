import type { SVGProps } from "react";

const STROKE = 1.85;

/** 侧栏导航图标：22×22 视口，线宽略增，形态互相区分（避免多枚「折角文档 / 麦克风」撞车） */
export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M4 10.5 12 4l8 6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v10h4v-6h4v6h4V10" strokeLinejoin="round" />
    </svg>
  );
}

/** 控制台 / 任务列表：终端指示线 */
export function IconJobs(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <rect x="3" y="4" width="18" height="14" rx="2" strokeLinejoin="round" />
      <path d="M6 8.5h6M6 12h9M6 15.5h5" strokeLinecap="round" />
      <path d="M17 17l2 2" strokeLinecap="round" />
    </svg>
  );
}

/** 笔记：装订边 + 内页横线（与草稿剪贴板区分） */
export function IconNotes(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M7 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M9 3v18" strokeLinecap="round" opacity={0.4} />
      <path d="M12 13h4M12 16.5h3" strokeLinecap="round" />
    </svg>
  );
}

/** AI 播客：不对称声波 + 拾音意象（与「竖条均衡器」音色入口区分） */
export function IconMic(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M8 14a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M12 18v3" strokeLinecap="round" />
      <path d="M9.5 21h5" strokeLinecap="round" />
      <path d="M10 10V8a2 2 0 1 1 4 0v2" strokeLinejoin="round" />
      <path d="M17 7v2c0 2-1.5 3.5-3.5 3.5" strokeLinecap="round" />
      <path d="M7 9v1c0 1.6 1 2.8 2.3 3.2" strokeLinecap="round" />
    </svg>
  );
}

/** 创作入口：圆内加号（聚合播客 / 文本转语音 / 笔记等起点） */
export function IconCreate(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <circle cx="12" cy="12" r="9" strokeLinejoin="round" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

/** 文本转语音：段落 + 扬声器 */
export function IconTts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M4 7h8M4 10.5h6M4 14h7" strokeLinecap="round" />
      <path d="M15 8v8l3.5-2.5V10.5L15 8z" strokeLinejoin="round" />
      <path d="M19.5 9.5a3 3 0 0 1 0 5" strokeLinecap="round" />
    </svg>
  );
}

/** 音色库：均衡器竖条（无麦克风轮廓） */
export function IconVoice(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M6 18V11" strokeLinecap="round" />
      <path d="M10 18V6" strokeLinecap="round" />
      <path d="M14 18v-7" strokeLinecap="round" />
      <path d="M18 18V9" strokeLinecap="round" />
      <path d="M4.5 18.5h15" strokeLinecap="round" opacity={0.4} />
    </svg>
  );
}

/** 我的作品：宫格 + 小三角播放提示 */
export function IconGrid(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="13" y="4" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="4" y="13" width="7" height="7" rx="1" strokeLinejoin="round" />
      <path d="M14.5 15.5l3.5 2.2v-4.4l-3.5 2.2z" strokeLinejoin="round" />
    </svg>
  );
}

/** 草稿：剪贴板 + 勾选/横线 */
export function IconDraft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M9 3h6l1 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l1-2z" strokeLinejoin="round" />
      <path d="M9 10.5l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 17h6" strokeLinecap="round" />
    </svg>
  );
}

/** 风格模板：虚线框 + 布局参考线 */
export function IconTemplate(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2" strokeLinejoin="round" />
      <path d="M4 9.5h16M9.5 4v16" strokeLinecap="round" opacity={0.35} />
      <path d="M15 15l3 3" strokeLinecap="round" />
    </svg>
  );
}

/** 我的：用户轮廓 */
export function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <circle cx="12" cy="8" r="3.5" strokeLinejoin="round" />
      <path d="M6.5 20.5v-1c0-2.5 2-4.5 5.5-4.5s5.5 2 5.5 4.5v1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" strokeLinejoin="round" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.61V22a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.61 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1 2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.61-1H2a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.61-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.61V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.61 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c0 .65.37 1.24.94 1.54z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSubscription(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" strokeLinejoin="round" />
      <path d="M2 10h20" strokeLinecap="round" />
      <path d="M7 14h4" strokeLinecap="round" />
      <path d="M16 12.5v3M14.5 14h3" strokeLinecap="round" />
    </svg>
  );
}

export function IconAdmin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M12 2l2.2 4.5L19 7.3l-3.4 3.3.8 4.9L12 13.9 7.6 15.5l.8-4.9L5 7.3l4.8-.8L12 2z" strokeLinejoin="round" />
      <path d="M12 13.5V22M8 18h8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M16 16l5 5" strokeLinecap="round" />
    </svg>
  );
}

/** 文稿剪辑：胶片孔 + 斜向剪口（与麦克风 / TTS 区分） */
export function IconClip(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <rect x="4" y="6.5" width="16" height="11" rx="1.5" strokeLinejoin="round" />
      <path d="M7 6.5v-2M10 6.5v-2M13 6.5v-2M16 6.5v-2" strokeLinecap="round" opacity={0.45} />
      <path d="M4 12h16" strokeLinecap="round" opacity={0.22} />
      <path d="M12 10.5l-2.2 5M12 10.5l2.2 5" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
