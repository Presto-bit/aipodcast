"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WORKBENCH_SCRIM_Z_CLASS } from "../../lib/workbenchOverlays";
import { useWorkbenchOverlayDismiss } from "../../lib/useWorkbenchOverlayDismiss";

const SCRIM_TONE_CLASS = {
  "35": "bg-black/35",
  "40": "bg-black/40",
  "45": "bg-black/45",
  "50": "bg-black/50"
} as const;

type ScrimTone = keyof typeof SCRIM_TONE_CLASS;

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  scrimTone?: ScrimTone;
  align?: "center" | "end";
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  escape?: boolean;
};

/**
 * 工作台标准遮罩弹层：portal 到 body、尊重 fym-workspace-scrim 左侧留白、侧栏导航时自动关闭。
 */
export default function WorkspaceScrimModal({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  className = "",
  scrimTone = "40",
  align = "center",
  busy = false,
  dismissOnBackdrop = true,
  escape = true
}: Props) {
  useWorkbenchOverlayDismiss(open, onClose, { busy, escape });

  if (!open || typeof document === "undefined") return null;

  const alignClass =
    align === "end" ? "items-end justify-center sm:items-center" : "items-center justify-center";

  return createPortal(
    <div
      className={[
        "fym-workspace-scrim",
        WORKBENCH_SCRIM_Z_CLASS,
        "flex",
        alignClass,
        SCRIM_TONE_CLASS[scrimTone],
        "p-4",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-modal="true"
      {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      onPointerDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {children}
    </div>,
    document.body
  );
}
