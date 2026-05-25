"use client";

import { useState } from "react";
import { IconChevronLeft, IconClipboard } from "../icons";
import { buildSocialPublishClipboardText, copyGuideLines } from "../../lib/socialPublishCopy";
import { platformLabel } from "../../lib/socialPublishPresets";
import type { SocialPublishDraft, SocialPublishPlatform } from "../../lib/socialPublishTypes";

type Props = {
  draft: SocialPublishDraft;
  platform: SocialPublishPlatform;
  onDraftChange: (d: SocialPublishDraft) => void;
  onBack: () => void;
  onClose: () => void;
  onCopy: () => void | Promise<void>;
};

const inputCls =
  "w-full rounded-lg border border-line bg-fill p-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function NotesSocialPublishStudio({ draft, platform, onDraftChange, onBack, onClose, onCopy }: Props) {
  const [copyHint, setCopyHint] = useState("");

  return (
    <div className="fixed inset-0 z-[540] flex flex-col bg-surface">
      <header className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
            onClick={onBack}
          >
            <IconChevronLeft width={16} height={16} />
            返回
          </button>
          <span className="text-sm font-semibold text-ink">{platformLabel(platform)} · 编辑与预览</span>
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={onClose}>
            关闭
          </button>
        </div>
        {"compliance" in draft && draft.compliance ? (
          <p className="text-center text-[11px] text-muted">{draft.compliance.userMessage}</p>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2">
        <div className="min-h-0 overflow-y-auto border-b border-line p-4 lg:border-b-0 lg:border-r">
          {draft.platform === "xiaohongshu" ? (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-ink">
                标题（点选主标题）
                <div className="mt-1 space-y-1">
                  {draft.titles.map((t, i) => (
                    <label key={`${i}-${t.slice(0, 12)}`} className="flex gap-2 text-sm">
                      <input
                        type="radio"
                        checked={draft.selectedTitleIndex === i}
                        onChange={() => onDraftChange({ ...draft, selectedTitleIndex: i })}
                      />
                      <input
                        type="text"
                        className={inputCls}
                        value={t}
                        onChange={(e) => {
                          const titles = [...draft.titles];
                          titles[i] = e.target.value;
                          onDraftChange({ ...draft, titles });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </label>
              <label className="block text-xs font-medium text-ink">
                正文
                <textarea
                  className={`mt-1 min-h-40 ${inputCls}`}
                  value={draft.body}
                  onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-ink">
                话题（逗号分隔）
                <input
                  type="text"
                  className={`mt-1 ${inputCls}`}
                  value={draft.tags.join("，")}
                  onChange={(e) =>
                    onDraftChange({
                      ...draft,
                      tags: e.target.value.split(/[,，\s#]+/).filter(Boolean)
                    })
                  }
                />
              </label>
              <label className="block text-xs font-medium text-ink">
                互动句
                <input
                  type="text"
                  className={`mt-1 ${inputCls}`}
                  value={draft.interaction}
                  onChange={(e) => onDraftChange({ ...draft, interaction: e.target.value })}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-ink">
                标题
                <input
                  type="text"
                  className={`mt-1 ${inputCls}`}
                  value={draft.title}
                  onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-ink">
                摘要（≤120 字）
                <input
                  type="text"
                  className={`mt-1 ${inputCls}`}
                  value={draft.digest}
                  maxLength={120}
                  onChange={(e) => onDraftChange({ ...draft, digest: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-ink">
                正文（Markdown）
                <textarea
                  className={`mt-1 min-h-48 font-mono text-xs ${inputCls}`}
                  value={draft.body}
                  onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-ink">
                文末引导
                <input
                  type="text"
                  className={`mt-1 ${inputCls}`}
                  value={draft.cta}
                  onChange={(e) => onDraftChange({ ...draft, cta: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col bg-fill/20 p-4">
          <p className="mb-2 text-xs font-medium text-muted">预览（仅供参考）</p>
          <div
            className={`mx-auto min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-soft ${
              platform === "xiaohongshu" ? "max-w-[360px]" : "max-w-[480px] w-full"
            }`}
          >
            {draft.platform === "xiaohongshu" ? (
              <>
                <p className="text-base font-bold text-ink">
                  {draft.titles[draft.selectedTitleIndex] || draft.titles[0]}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft.body}</p>
                {draft.tags.length ? (
                  <p className="mt-3 text-xs text-brand">
                    {draft.tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}
                  </p>
                ) : null}
                {draft.interaction ? (
                  <p className="mt-3 text-xs text-muted">{draft.interaction}</p>
                ) : null}
              </>
            ) : (
              <>
                <h1 className="text-lg font-bold text-ink">{draft.title}</h1>
                {draft.digest ? <p className="mt-2 text-xs text-muted">{draft.digest}</p> : null}
                <div className="prose prose-sm mt-4 max-w-none whitespace-pre-wrap text-sm text-ink">
                  {draft.body}
                </div>
                {draft.cta ? <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{draft.cta}</p> : null}
              </>
            )}
          </div>
          <ol className="mt-3 list-decimal pl-4 text-[10px] text-muted">
            {copyGuideLines(platform).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-line p-3">
        {copyHint ? (
          <p className="text-center text-[11px] font-medium text-brand">{copyHint}</p>
        ) : null}
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-brand-foreground"
          onClick={() => {
            void (async () => {
              await onCopy();
              setCopyHint("已复制发布包，请按右侧指引到平台粘贴");
            })();
          }}
        >
          <IconClipboard width={18} height={18} />
          复制发布包
        </button>
      </footer>
    </div>
  );
}
