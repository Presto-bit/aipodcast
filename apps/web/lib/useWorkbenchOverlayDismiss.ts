"use client";

import { useEffect } from "react";
import { WORKBENCH_DISMISS_OVERLAYS_EVENT } from "./workbenchOverlays";

type Options = {
  busy?: boolean;
  /** 默认 true */
  escape?: boolean;
};

/**
 * 工作台弹层：侧栏切页时自动 onClose；可选 Escape 关闭。
 */
export function useWorkbenchOverlayDismiss(open: boolean, onClose: () => void, opts?: Options): void {
  const busy = opts?.busy ?? false;
  const escape = opts?.escape ?? true;

  useEffect(() => {
    if (!open) return;
    const handler = () => onClose();
    window.addEventListener(WORKBENCH_DISMISS_OVERLAYS_EVENT, handler);
    return () => window.removeEventListener(WORKBENCH_DISMISS_OVERLAYS_EVENT, handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !escape || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, escape, busy]);
}

/**
 * 监听工作台全局 dismiss（不要求 open）：用于一次关闭多处浮层 state。
 */
export function useWorkbenchDismissOverlaysEffect(onDismiss: () => void): void {
  useEffect(() => {
    const handler = () => onDismiss();
    window.addEventListener(WORKBENCH_DISMISS_OVERLAYS_EVENT, handler);
    return () => window.removeEventListener(WORKBENCH_DISMISS_OVERLAYS_EVENT, handler);
  }, [onDismiss]);
}
