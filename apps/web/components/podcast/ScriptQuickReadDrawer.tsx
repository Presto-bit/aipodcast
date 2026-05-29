"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../lib/auth";
import {
  formatScriptCharCountLabel,
  scriptCharCountForWork,
  scriptGenreChip,
  scriptSourceNoteLine
} from "../../lib/scriptCardPreview";
import { formatWorkCreatedAtZh } from "../../lib/worksNavMetaLine";
import { WorkHubManuscriptPreview } from "../works/WorkHubManuscriptPreview";
import { buildWorkDetailHref } from "./workGalleryNav";
import type { PodcastWorkRow } from "./workGalleryListShared";
import { useScriptManuscriptBody } from "./useScriptManuscriptBody";

type Props = {
  work: PodcastWorkRow | null;
  open: boolean;
  onClose: () => void;
  workDetailReturnTo?: string;
  onCopy: (jobId: string, work: PodcastWorkRow) => void;
  onDownload: (work: PodcastWorkRow) => void;
  copyBusy: boolean;
  downloadBusy: boolean;
};

export function ScriptQuickReadDrawer({
  work,
  open,
  onClose,
  workDetailReturnTo,
  onCopy,
  onDownload,
  copyBusy,
  downloadBusy
}: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const jobId = work?.id ? String(work.id) : "";
  const { body, loadingFull, error } = useScriptManuscriptBody(jobId, work, open);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !work || !jobId) return null;

  const chip = scriptGenreChip(work.type);
  const charCount = scriptCharCountForWork(work);
  const charLabel = formatScriptCharCountLabel(charCount);
  const created = formatWorkCreatedAtZh(work.createdAt);
  const source = scriptSourceNoteLine(work);
  const detailHref = buildWorkDetailHref(jobId, {
    returnTo: workDetailReturnTo,
    focusRead: true
  });
  const title = String(work.displayTitle || "").trim() || jobId;
  const chipCls =
    chip.tone === "social"
      ? "bg-cta/12 text-cta ring-cta/25"
      : "bg-brand/12 text-brand ring-brand/25";

  return createPortal(
    <div className="fixed inset-0 z-[1220]" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="关闭预览"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-quick-read-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-card max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:max-h-[85vh] max-md:rounded-t-2xl max-md:border-l-0 max-md:border-t"
      >
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className={`rounded-md px-1.5 py-0.5 font-semibold ring-1 ring-inset ${chipCls}`}>
                {chip.label}
              </span>
              {charLabel ? <span className="tabular-nums">{charLabel}</span> : null}
              {created !== "—" ? <span>{created}</span> : null}
            </div>
            <h2 id="script-quick-read-title" className="mt-1.5 text-base font-semibold leading-snug text-ink">
              <Link href={detailHref} className="hover:text-brand hover:underline" onClick={onClose}>
                {title}
              </Link>
            </h2>
            {source ? (
              source.notebookHref ? (
                <Link
                  href={source.notebookHref}
                  className="mt-1 inline-block text-[11px] text-brand hover:underline"
                  title={source.title}
                  onClick={onClose}
                >
                  📎 {source.text}
                </Link>
              ) : (
                <p className="mt-1 text-[11px] text-muted" title={source.title}>
                  📎 {source.text}
                </p>
              )
            ) : null}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loadingFull && !body ? (
            <p className="text-sm text-muted" aria-busy>
              正文加载中…
            </p>
          ) : (
            <WorkHubManuscriptPreview
              body={body}
              emptyHint="暂无摘要，请在详情页查看或稍后重试。"
              scrollContained={false}
            />
          )}
          {loadingFull && body ? (
            <p className="mt-2 text-[11px] text-muted" aria-live="polite">
              正在加载完整正文…
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 text-[11px] text-danger-ink" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-fill/30 px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
            disabled={copyBusy}
            onClick={() => onCopy(jobId, work)}
          >
            {copyBusy ? "复制中…" : "复制全文"}
          </button>
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
            disabled={downloadBusy}
            onClick={() => onDownload(work)}
          >
            {downloadBusy ? "下载中…" : "下载"}
          </button>
          <Link
            href={detailHref}
            className="ml-auto rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/15"
            onClick={onClose}
          >
            完整详情 →
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}
