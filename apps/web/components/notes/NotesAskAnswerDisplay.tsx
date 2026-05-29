"use client";

import { useMemo, useState, useEffect } from "react";
import WorkspaceScrimModal from "../ui/WorkspaceScrimModal";
import {
  sourceHasCitableChunks,
  type NotesAskSource,
  type NotesAskWebSource
} from "../../lib/notesAskCitation";
import {
  isDismissedNotesAskSupplement,
  normalizeNotesAskAnswerForDisplay
} from "../../lib/notesAskAnswerNormalize";
import {
  markGeneralReferenceToastSeen,
  NOTES_ASK_GENERAL_REFERENCE_DISCLAIMER,
  NOTES_ASK_LOW_CONFIDENCE_HINT,
  shouldShowGeneralReferenceToast
} from "../../lib/notesAskGeneralReference";
import NotesAskAnswerMarkdownBody from "./NotesAskAnswerMarkdownBody";

type Props = {
  /** 仅资料摘录支持的回答正文 */
  text: string;
  /** 通识参考块（非资料原文），与 text 分开展示 */
  supplementContent?: string;
  /** 本轮检索置信度偏低 */
  lowConfidence?: boolean;
  /** 与编排器 done.sources 一致；有则正文 [n] 可点击查看摘录。 */
  sources?: NotesAskSource[];
  /** 联网检索条目，[w1] 外链与脚注 */
  webSources?: NotesAskWebSource[];
  /** 答后关联问句（至多 1 条），与正文同区展示、无独立卡片 */
  followUpQuestion?: string;
  onFollowUpClick?: (question: string) => void;
  /** 在资料预览中高亮定位（charStart/charEnd 来自检索块） */
  onOpenSourceInPreview?: (source: NotesAskSource, chunk?: { charStart?: number; charEnd?: number; excerpt?: string }) => void;
  className?: string;
};

export { normalizeNotesAskAnswerForDisplay } from "../../lib/notesAskAnswerNormalize";

function SourceExcerptModal({
  source,
  open,
  onClose,
  onOpenInPreview
}: {
  source: NotesAskSource | null;
  open: boolean;
  onClose: () => void;
  onOpenInPreview?: (source: NotesAskSource, chunk?: { charStart?: number; charEnd?: number; excerpt?: string }) => void;
}) {
  if (!open || !source) return null;

  return (
    <WorkspaceScrimModal open labelledBy="notes-ask-source-modal-title" scrimTone="45" onClose={onClose}>
      <div
        className="max-h-[min(80vh,560px)] w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line/80 px-4 py-3">
          <h2 id="notes-ask-source-modal-title" className="text-sm font-semibold text-ink">
            引用摘录 [{source.index}] {source.title}
          </h2>
          <p className="mt-1 text-[11px] text-muted">以下为回答所依据的检索片段，非全书预览</p>
        </div>
        <div className="max-h-[min(60vh,440px)] overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-ink">
          {source.chunks && source.chunks.length > 0 ? (
            <ul className="space-y-3">
              {source.chunks.map((c, i) => (
                <li key={`${c.chunkIndex}-${i}`} className="rounded-lg border border-line/70 bg-fill/40 p-2.5">
                  <p className="text-[11px] font-medium text-muted">
                    块 {c.chunkIndex}
                    {c.score ? <span className="ml-2">score {c.score}</span> : null}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-ink">{c.excerpt || "（无摘录）"}</p>
                  {onOpenInPreview &&
                  (typeof c.charStart === "number" || (c.excerpt && c.excerpt.length > 0)) ? (
                    <button
                      type="button"
                      className="mt-2 rounded border border-brand/40 bg-brand/5 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/10"
                      onClick={() => {
                        onOpenInPreview(source, {
                          charStart: c.charStart,
                          charEnd: c.charEnd,
                          excerpt: c.excerpt
                        });
                        onClose();
                      }}
                    >
                      查看引用上下文
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              <p className="text-muted">
                本轮回答未附带该资料的检索摘录。正文 [{source.index}] 仍标记该条资料，但无法展示引用片段。
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line/80 px-4 py-2.5">
          {onOpenInPreview && source && sourceHasCitableChunks(source) ? (
            <button
              type="button"
              className="rounded-md border border-brand/40 bg-brand/5 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/10"
              onClick={() => {
                const c0 =
                  source.chunks?.find((c) => (c.excerpt || "").trim()) || source.chunks?.[0];
                onOpenInPreview(source, {
                  charStart: c0?.charStart,
                  charEnd: c0?.charEnd,
                  excerpt: c0?.excerpt
                });
                onClose();
              }}
            >
              查看引用上下文
            </button>
          ) : null}
          {onOpenInPreview && source ? (
            <button
              type="button"
              className="rounded-md border border-line/60 bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-fill hover:text-ink"
              onClick={() => {
                onOpenInPreview(source);
                onClose();
              }}
            >
              查看全书原文
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </WorkspaceScrimModal>
  );
}

/**
 * 对话回答区：GFM Markdown + 段落/列表/代码块等排版；可选将 [n] 标为可点击查看摘录的内链。
 */
export function NotesAskAnswerDisplay({
  text,
  supplementContent,
  lowConfidence = false,
  sources,
  webSources,
  followUpQuestion,
  onFollowUpClick,
  onOpenSourceInPreview,
  className
}: Props) {
  const [modalSource, setModalSource] = useState<NotesAskSource | null>(null);
  const [webSourcesOpen, setWebSourcesOpen] = useState(false);
  const [generalRefToast, setGeneralRefToast] = useState("");

  const supplementBody = useMemo(() => {
    const raw = String(supplementContent || "").trim();
    if (!raw || isDismissedNotesAskSupplement(raw)) return "";
    return normalizeNotesAskAnswerForDisplay(raw);
  }, [supplementContent]);

  useEffect(() => {
    if (!supplementBody) return;
    if (!shouldShowGeneralReferenceToast()) return;
    markGeneralReferenceToastSeen();
    setGeneralRefToast("本次回答包含通识参考，非你的资料原文，请自行核实。");
    const t = window.setTimeout(() => setGeneralRefToast(""), 4200);
    return () => window.clearTimeout(t);
  }, [supplementBody]);

  const sortedSources = useMemo(() => {
    if (!sources?.length) return [];
    return [...sources].sort((a, b) => Number(a.index) - Number(b.index));
  }, [sources]);

  const sortedWebSources = useMemo(() => {
    if (!webSources?.length) return [];
    return [...webSources].sort((a, b) => {
      const na = Number(String(a.index).replace(/^w/i, "")) || 0;
      const nb = Number(String(b.index).replace(/^w/i, "")) || 0;
      return na - nb;
    });
  }, [webSources]);

  const wrap = className?.trim() ? className : "";

  return (
    <div className={`notes-ask-answer flex min-w-0 flex-col gap-3 text-ink ${wrap}`}>
      {generalRefToast ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950 dark:text-amber-100"
          role="status"
        >
          {generalRefToast}
        </p>
      ) : null}
      {lowConfidence && !supplementBody ? (
        <p className="rounded-lg border border-line/80 bg-fill/50 px-2.5 py-1.5 text-[11px] leading-snug text-muted">
          {NOTES_ASK_LOW_CONFIDENCE_HINT}
        </p>
      ) : null}
      <NotesAskAnswerMarkdownBody
        text={text}
        sources={sources}
        webSources={webSources}
        onCitationClick={(index) => {
          const src = sortedSources.find((s) => s.index === index);
          if (!src) return;
          setModalSource(src);
        }}
      />
      {supplementBody ? (
        <section
          className="mt-1 border-t border-amber-500/35 pt-3"
          aria-label="通识参考"
        >
          <p className="mb-2 text-[11px] leading-snug text-amber-900/90 dark:text-amber-100/90">
            {NOTES_ASK_GENERAL_REFERENCE_DISCLAIMER}
          </p>
          <NotesAskAnswerMarkdownBody text={supplementBody} sources={[]} webSources={[]} />
        </section>
      ) : null}

      {followUpQuestion?.trim() ? (
        <p className="mt-4 min-w-0 text-[14px] leading-[1.65] text-ink">
          <span>相关提问：</span>
          {onFollowUpClick ? (
            <button
              type="button"
              className="ml-1 inline text-left font-[inherit] text-[length:inherit] leading-[inherit] text-ink decoration-none underline-offset-0 hover:text-ink/80"
              title={followUpQuestion.trim()}
              onClick={() => onFollowUpClick(followUpQuestion.trim())}
            >
              {followUpQuestion.trim()}
            </button>
          ) : (
            <span className="ml-1">{followUpQuestion.trim()}</span>
          )}
        </p>
      ) : null}

      {sortedWebSources.length > 0 ? (
        <aside
          className="mt-1 border-t border-line/70 pt-3 text-xs text-ink"
          aria-label="网页参考"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg py-0.5 text-left text-ink hover:bg-fill/50"
            onClick={() => setWebSourcesOpen((o) => !o)}
            aria-expanded={webSourcesOpen}
            aria-controls="notes-ask-web-footnotes"
          >
            <span className="font-semibold">网页参考（联网检索）</span>
            <span className="shrink-0 text-[11px] font-medium text-muted">{webSourcesOpen ? "收起" : "展开"}</span>
          </button>
          {webSourcesOpen ? (
            <div id="notes-ask-web-footnotes" className="mt-2">
              <p className="text-[11px] text-muted">
                正文中的 [w1] 等为互联网摘要角标，仅供参考；与资料库冲突时以资料库为准。点击标题在新标签页打开。
              </p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] leading-snug">
                {sortedWebSources.map((s) => (
                  <li key={s.index} id={`cite-${s.index}`} className="scroll-mt-20">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand underline break-all"
                    >
                      [{s.index}] {s.title}
                    </a>
                    {s.snippet ? <p className="mt-1 text-[11px] leading-snug text-muted">{s.snippet}</p> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </aside>
      ) : null}

      <SourceExcerptModal
        source={modalSource}
        open={modalSource != null}
        onClose={() => setModalSource(null)}
        onOpenInPreview={onOpenSourceInPreview}
      />
    </div>
  );
}
