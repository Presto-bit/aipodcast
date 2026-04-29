"use client";

import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  featureLabel: string;
  onClose: () => void;
  onGoLogin: () => void;
};

export default function LoginRequiredToast({ open, featureLabel, onClose, onGoLogin }: Props) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[1300] w-[min(92vw,24rem)] rounded-xl border border-line bg-surface p-3 shadow-soft">
      <p className="text-sm font-medium text-ink">登录后继续使用</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        游客可先浏览，{featureLabel}需登录/注册后使用。
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-line bg-fill px-3 py-1.5 text-xs text-ink hover:bg-canvas"
          onClick={onClose}
        >
          先逛逛
        </button>
        <button
          type="button"
          className="rounded-lg bg-cta px-3 py-1.5 text-xs font-medium text-cta-foreground hover:bg-cta/90"
          onClick={onGoLogin}
        >
          去登录
        </button>
      </div>
    </div>,
    document.body
  );
}
