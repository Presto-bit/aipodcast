"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { SocialPublishDraft } from "../../lib/socialPublishTypes";
import {
  HOME_COMPOSER_FORMAT_LABELS,
  type HomeComposerFormat,
  type HomeComposerFormatResult
} from "../../lib/homeComposerTypes";
import { socialDraftToCopyText } from "../../lib/homeComposerFormatJobs";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <p className="text-sm text-muted">加载内容…</p> }
);

const COPY_HINTS: Record<HomeComposerFormat | "all", string> = {
  xhs: "已复制 · 打开小红书 → + → 粘贴正文",
  mp: "已复制 · 去公众号编辑器粘贴即可",
  voice: "已复制 · 粘贴到提词器或剪辑软件",
  podcast: "已复制 · 可进工作室补 TTS",
  all: "已复制 · 全部内容已在剪贴板"
};

type Props = {
  format: HomeComposerFormat;
  result: HomeComposerFormatResult;
  onCopyToast?: (message: string) => void;
};

function copyText(text: string, hint: string, onCopyToast?: (message: string) => void) {
  void navigator.clipboard.writeText(text).then(() => onCopyToast?.(hint));
}

function CopyFooter({
  label,
  onCopy
}: {
  label: string;
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex justify-end border-t border-line/50 pt-3">
      <button
        type="button"
        className="text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
        onClick={() => {
          onCopy();
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? "已复制" : label}
      </button>
    </div>
  );
}

function RunningBlock({ format, progress }: { format: HomeComposerFormat; progress?: string }) {
  const label = HOME_COMPOSER_FORMAT_LABELS[format];
  const detail = (progress || "").trim();
  const status =
    detail.includes("排队") || detail === "准备中…"
      ? "排队等待中，通常很快开始"
      : detail.includes("撰写") || detail.includes("生成")
        ? "AI 撰写中"
        : detail || "正在准备";

  return (
    <div className="w-full py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5 text-sm text-muted">
        <span
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand"
          aria-hidden
        />
        <span>
          正在生成{label}… <span className="text-ink/80">{status}</span>
        </span>
      </div>
    </div>
  );
}

function ErrorBlock({ format, error }: { format: HomeComposerFormat; error: string }) {
  return (
    <div className="w-full py-2">
      <p className="text-sm font-medium text-danger-ink">{HOME_COMPOSER_FORMAT_LABELS[format]} · 生成失败</p>
      <p className="mt-1 text-sm text-danger-ink/90">{error}</p>
    </div>
  );
}

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="notes-ask-answer min-w-0 [&_.notes-ask-answer-md]:max-w-none">
      <NotesAskAnswerMarkdownBody text={text} />
    </div>
  );
}

function XhsBlock({
  draft,
  onCopyToast
}: {
  draft: SocialPublishDraft;
  onCopyToast?: (message: string) => void;
}) {
  const [titleIdx, setTitleIdx] = useState(0);

  return (
    <div className="w-full min-w-0">
      <p className="mb-2 text-xs font-medium text-muted">标题（点选）</p>
      <div className="mb-4 flex flex-col gap-1">
        {draft.titles.map((t, i) => (
          <button
            key={`${t}-${i}`}
            type="button"
            className={[
              "rounded-lg px-1 py-1 text-left text-[15px] transition",
              titleIdx === i ? "font-semibold text-ink" : "text-ink/90 hover:text-ink"
            ].join(" ")}
            onClick={() => setTitleIdx(i)}
          >
            {titleIdx === i ? "● " : "○ "}
            {t}
          </button>
        ))}
      </div>
      <div className="whitespace-pre-wrap text-[15px] leading-[1.72] text-ink">{draft.body}</div>
      <CopyFooter
        label="复制正文"
        onCopy={() => copyText(draft.body, COPY_HINTS.xhs, onCopyToast)}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="text-sm text-brand underline decoration-dotted underline-offset-4 hover:opacity-80"
          onClick={() => copyText(socialDraftToCopyText(draft, titleIdx), COPY_HINTS.all, onCopyToast)}
        >
          复制全部（含标题）
        </button>
      </div>
    </div>
  );
}

function MpBlock({ draft, onCopyToast }: { draft: SocialPublishDraft; onCopyToast?: (message: string) => void }) {
  const title = draft.titles[0] || draft.coverHook || "公众号稿件";
  const summary = draft.theme || draft.opening30 || "";
  const all = [title, summary, draft.body].filter(Boolean).join("\n\n");

  return (
    <div className="w-full min-w-0">
      <div className="text-[17px] font-semibold text-ink">{title}</div>
      {summary ? <p className="mt-1 text-sm text-muted">{summary}</p> : null}
      <div className="mt-4">
        <MarkdownBody text={draft.body} />
      </div>
      <CopyFooter label="复制全文" onCopy={() => copyText(all, COPY_HINTS.mp, onCopyToast)} />
    </div>
  );
}

function ScriptBlock({
  format,
  scriptText,
  onCopyToast
}: {
  format: "voice" | "podcast";
  scriptText: string;
  onCopyToast?: (message: string) => void;
}) {
  const label = format === "voice" ? "口播脚本" : "播客大纲";
  const words = scriptText.replace(/\s/g, "").length;

  return (
    <div className="w-full min-w-0">
      <p className="mb-3 text-xs text-muted">
        {label} · {words} 字
      </p>
      <MarkdownBody text={scriptText} />
      <CopyFooter
        label={format === "voice" ? "复制脚本" : "复制大纲"}
        onCopy={() => copyText(scriptText, COPY_HINTS[format], onCopyToast)}
      />
    </div>
  );
}

export default function HomeComposerFormatCard({ format, result, onCopyToast }: Props) {
  if (result.status === "pending" || result.status === "running") {
    return <RunningBlock format={format} progress={result.progress} />;
  }
  if (result.status === "error") {
    return <ErrorBlock format={format} error={result.error} />;
  }
  if (result.status !== "done") {
    return <ErrorBlock format={format} error="未知状态" />;
  }
  if (result.social && (format === "xhs" || format === "mp")) {
    return format === "xhs" ? (
      <XhsBlock draft={result.social} onCopyToast={onCopyToast} />
    ) : (
      <MpBlock draft={result.social} onCopyToast={onCopyToast} />
    );
  }
  if (result.scriptText && (format === "voice" || format === "podcast")) {
    return <ScriptBlock format={format} scriptText={result.scriptText} onCopyToast={onCopyToast} />;
  }
  return <ErrorBlock format={format} error="任务已完成但未返回内容" />;
}
