"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function IconSubscriptionCrown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 17l2-8h4l3 6 3-10 3 10 3-6h4l2 8H2z" />
      <path d="M4 17v3h16v-3" />
    </svg>
  );
}

type SubscriptionVipLinkProps = {
  /** 鼠标悬停与无障碍说明 */
  title?: string;
  className?: string;
  /**
   * 与左侧主按钮拼成同一圆角框：右侧竖分割线 + 图标，无独立外框。
   * 用于工具条 pill、作品卡片操作区等。
   */
  segment?: boolean;
};

/**
 * 未满足订阅条件时跳转 `/subscription`；仅用皇冠图标表示「会员 / 升级」，文案放在 `title` / `aria-label`。
 */
export function SubscriptionVipLink({ title = "升级套餐后可使用，点击查看订阅", className, segment }: SubscriptionVipLinkProps) {
  return (
    <Link
      href="/subscription"
      title={title}
      aria-label={title}
      className={
        className ??
        [
          "inline-flex shrink-0 items-center justify-center text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300",
          segment
            ? "min-h-[1.75rem] min-w-[2.25rem] border-l border-amber-500/30 bg-amber-500/[0.07] px-2"
            : "h-7 min-w-[1.75rem] rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5"
        ].join(" ")
      }
    >
      <IconSubscriptionCrown className="h-3 w-3" />
    </Link>
  );
}

type LockedToolbarChipPillProps = {
  /** 与 chip 正文一致 */
  label: ReactNode;
  upgradeTitle: string;
};

/** 工具条上未解锁能力：整段胶囊（文案 + 皇冠）点击跳转订阅页。 */
export function LockedToolbarChipPill({ label, upgradeTitle }: LockedToolbarChipPillProps) {
  return (
    <Link
      href="/subscription"
      title={upgradeTitle}
      aria-label={upgradeTitle}
      className="inline-flex max-w-full min-w-0 overflow-hidden rounded-full border border-line bg-surface text-inherit shadow-sm no-underline transition-colors hover:bg-fill/80"
    >
      <span className="max-w-[calc(100%-2.5rem)] min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs font-medium text-muted">
        {label}
      </span>
      <span className="inline-flex min-h-[1.75rem] min-w-[2.25rem] shrink-0 items-center justify-center border-l border-amber-500/30 bg-amber-500/[0.07] px-2 text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300">
        <IconSubscriptionCrown className="h-3 w-3" />
      </span>
    </Link>
  );
}

type GatedSplitActionProps = {
  locked: boolean;
  upgradeTitle: string;
  onClick: () => void;
  disabled?: boolean;
  /** 解锁时的按钮 class（圆角、品牌色等） */
  unlockedClassName: string;
  /** 锁定态外壳：与解锁按钮边框语义一致 */
  variant?: "default" | "brand";
  children: ReactNode;
  /** 锁定态外层 Link 的额外 class（如下拉菜单全宽：`w-full rounded-none border-0`） */
  lockedLinkClassName?: string;
  /** 锁定态左侧文案区域的额外 class */
  lockedLabelClassName?: string;
  /** 锁定态跳转订阅前回调（如关闭下拉菜单） */
  onLockedNavigate?: () => void;
};

/**
 * 作品卡片等：`locked` 时主文案与皇冠入口同处一个 `rounded-md` 边框内；解锁时为普通按钮。
 */
export function GatedSplitAction({
  locked,
  upgradeTitle,
  onClick,
  disabled,
  unlockedClassName,
  variant = "default",
  children,
  lockedLinkClassName,
  lockedLabelClassName,
  onLockedNavigate
}: GatedSplitActionProps) {
  if (!locked) {
    return (
      <button type="button" className={unlockedClassName} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    );
  }
  const shell =
    variant === "brand"
      ? "inline-flex max-w-full min-w-0 overflow-hidden rounded-md border border-brand/45 bg-brand/10 shadow-sm text-inherit no-underline transition-colors hover:bg-brand/15"
      : "inline-flex max-w-full min-w-0 overflow-hidden rounded-md border border-line bg-surface shadow-sm text-inherit no-underline transition-colors hover:bg-fill/80";
  const labelCls =
    variant === "brand"
      ? "text-[11px] font-medium text-brand opacity-80"
      : "text-[11px] text-ink opacity-70";
  const linkCls = [shell, lockedLinkClassName].filter(Boolean).join(" ");
  const labelSpanCls = ["min-w-0 flex-1 truncate px-2 py-1 text-left", labelCls, lockedLabelClassName].filter(Boolean).join(" ");
  return (
    <Link
      href="/subscription"
      title={upgradeTitle}
      aria-label={upgradeTitle}
      className={linkCls}
      onClick={() => onLockedNavigate?.()}
    >
      <span className={labelSpanCls}>{children}</span>
      <span className="inline-flex min-h-[1.75rem] min-w-[2.25rem] shrink-0 items-center justify-center border-l border-amber-500/35 bg-amber-500/[0.08] px-2 text-amber-800 dark:text-amber-300">
        <IconSubscriptionCrown className="h-3 w-3" />
      </span>
    </Link>
  );
}
