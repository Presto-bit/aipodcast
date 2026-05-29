"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  formatScriptCharCountLabel,
  scriptCharCountForWork,
  scriptGenreChip,
  scriptSourceNoteLine,
  scriptWorkGenreLabel
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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const jobId = work?.id ? String(work.id) : "";
  const { body, loadingFull, error } = useScriptManuscriptBody(jobId, work, open);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
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
  const metaLine = [created !== "—" ? created : "", scriptWorkGenreLabel(work)].filter(Boolean).join(" · ");

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1220]" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="script-quick-read-title"
        className="pointer-events-auto fixed flex h-auto w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,28rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card right-4 top-[4.5rem] max-md:inset-x-4 max-md:bottom-4 max-md:top-auto max-md:max-h-[65vh] max-md:w-auto"
      >
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className={`rounded-md px-1.5 py-0.5 font-semibold ring-1 ring-inset ${chipCls}`}>
                {chip.label}
              </span>
              {charLabel ? <span className="tabular-nums">{charLabel}</span> : null}
            </div>
            <h2 id="script-quick-read-title" className="mt-1.5 truncate text-base font-semibold leading-snug text-ink">
              <Link href={detailHref} className="hover:text-brand hover:underline" onClick={onClose} title={title}>
                {title}
              </Link>
            </h2>
            {metaLine ? (
              <p className="mt-1 truncate text-[11px] text-muted" title={metaLine}>
                {metaLine}
              </p>
            ) : null}
            {source ? (
              source.notebookHref ? (
                <Link
                  href={source.notebookHref}
                  className="mt-1 block min-w-0 truncate text-[11px] text-brand hover:underline"
                  title={source.title}
                  onClick={onClose}
                >
                  📎 {source.text}
                </Link>
              ) : (
                <p className="mt-1 truncate text-[11px] text-muted" title={source.title}>
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

        <div className="max-h-[calc(min(70vh,28rem)-8.5rem)] shrink overflow-y-auto overscroll-contain px-4 py-3 max-md:max-h-[calc(65vh-8.5rem)]">
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
