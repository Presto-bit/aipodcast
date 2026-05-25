"use client";

import { useState } from "react";
import { IconChevronLeft, IconClipboard } from "../icons";
import { buildSocialPublishClipboardText, copyGuideLines } from "../../lib/socialPublishCopy";
import { ensureXhsTitles, platformLabel } from "../../lib/socialPublishPresets";
import type { SocialPublishDraft } from "../../lib/socialPublishTypes";

type Props = {
  draft: SocialPublishDraft;
  onDraftChange: (d: SocialPublishDraft) => void;
  onBack: () => void;
  onClose: () => void;
  onCopy: () => void | Promise<void>;
};

const inputCls =
  "w-full rounded-lg border border-line bg-fill p-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function NotesSocialPublishStudio({ draft, onDraftChange, onBack, onClose, onCopy }: Props) {
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
          <span className="text-sm font-semibold text-ink">
            {platformLabel(draft.platform)} · 编辑与预览
          </span>
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={onClose}>
            关闭
          </button>
        </div>
        {draft.compliance ? (
          <p className="text-center text-[11px] text-muted">{draft.compliance.userMessage}</p>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2">
        <div className="min-h-0 overflow-y-auto border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-3">
            <label className="block text-xs font-medium text-ink">
              标题（3 选 1）
              <div className="mt-1 space-y-1">
                {draft.titles.map((t, i) => (
                  <label key={`title-${i}`} className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      checked={draft.selectedTitleIndex === i}
                      onChange={() => onDraftChange({ ...draft, selectedTitleIndex: i })}
                    />
                    <span className="mt-2 shrink-0 text-[10px] text-muted">备选 {i + 1}</span>
                    <input
                      type="text"
                      className={inputCls}
                      value={t}
                      maxLength={draft.platform === "wechat_mp" ? 64 : 28}
                      onChange={(e) => {
                        const next = [...draft.titles] as [string, string, string];
                        next[i] = e.target.value;
                        onDraftChange({ ...draft, titles: ensureXhsTitles(next) });
                      }}
                    />
                  </label>
                ))}
              </div>
            </label>
            <label className="block text-xs font-medium text-ink">
              正文
              <span className="ml-1 font-normal text-muted">
                {draft.platform === "wechat_mp"
                  ? "（已含话题与互动句，可用 Markdown）"
                  : "（已含话题与互动句）"}
              </span>
              <textarea
                className={`mt-1 min-h-48 ${inputCls} ${draft.platform === "wechat_mp" ? "font-mono text-xs" : ""}`}
                value={draft.body}
                onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
              />
            </label>
            {draft.imageSuggestions.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-ink">图片制作建议</p>
                <p className="mt-0.5 text-[10px] text-muted">发布配图时可参考，显示在正文之后</p>
                <ul className="mt-1.5 space-y-1.5 text-sm text-ink">
                  {draft.imageSuggestions.map((line, i) => (
                    <li key={`img-${i}`} className="rounded-lg border border-line/80 bg-fill/40 px-2 py-1.5">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-fill/20 p-4">
          <p className="mb-2 text-xs font-medium text-muted">预览（仅供参考）</p>
          <div
            className={`mx-auto min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-soft ${
              draft.platform === "xiaohongshu" ? "max-w-[360px]" : "max-w-[480px] w-full"
            }`}
          >
            <p className="text-base font-bold text-ink">
              {draft.titles[draft.selectedTitleIndex] || draft.titles[0]}
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft.body}</p>
            {draft.imageSuggestions.length ? (
              <div className="mt-4 border-t border-line/80 pt-3">
                <p className="text-[10px] font-medium text-muted">图片制作建议</p>
                <ul className="mt-1.5 list-decimal pl-4 text-[11px] leading-relaxed text-ink/90">
                  {draft.imageSuggestions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <ol className="mt-3 list-decimal pl-4 text-[10px] text-muted">
            {copyGuideLines(draft.platform).map((line) => (
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
