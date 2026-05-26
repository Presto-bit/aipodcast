"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";

type Props = {
  open: boolean;
  whoAmI: string;
  audience: string;
  oneLiner: string;
  onChangeWho: (v: string) => void;
  onChangeAudience: (v: string) => void;
  onChangeOneLiner: (v: string) => void;
  busy?: boolean;
  error?: string | null;
  onSubmit: () => void;
  onLater: () => void;
  onCancel: () => void;
};

export default function AuthorIpColdStartModal({
  open,
  whoAmI,
  audience,
  oneLiner,
  onChangeWho,
  onChangeAudience,
  onChangeOneLiner,
  busy,
  error,
  onSubmit,
  onLater,
  onCancel
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const doneDots = [Boolean(oneLiner.trim()), Boolean(whoAmI.trim()), Boolean(audience.trim())];

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="author-ip-cold-start-title"
        className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-5 shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="author-ip-cold-start-title" className="text-lg font-semibold text-ink">
            完善你的 IP 定位
          </h2>
          <button
            type="button"
            className="text-muted hover:text-ink"
            aria-label="关闭"
            disabled={busy}
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">约 30 秒；一句话定位必填。</p>

        <label className="mt-4 block text-sm font-medium text-ink">
          一句话定位 <span className="text-danger-ink">*</span>
          <textarea
            className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            rows={2}
            value={oneLiner}
            onChange={(e) => onChangeOneLiner(e.target.value)}
            placeholder="例如：帮职场人把复盘写成可发布的文章"
          />
        </label>
        <label className="mt-3 block text-sm text-ink">
          我是谁（选填）
          <textarea
            className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            rows={2}
            value={whoAmI}
            onChange={(e) => onChangeWho(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm text-ink">
          写给谁（选填）
          <textarea
            className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            rows={2}
            value={audience}
            onChange={(e) => onChangeAudience(e.target.value)}
          />
        </label>

        <div className="mt-3 flex gap-1.5" aria-hidden>
          {doneDots.map((d, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${d ? "bg-brand" : "bg-line"}`} />
          ))}
        </div>

        {error ? <p className="mt-2 text-sm text-danger-ink">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onLater}>
            稍后再说
          </Button>
          <Button type="button" disabled={busy || !oneLiner.trim()} onClick={onSubmit}>
            {busy ? "保存中…" : "完成"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
