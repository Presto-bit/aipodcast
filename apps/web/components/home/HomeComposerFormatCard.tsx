"use client";

import { useCallback, useState } from "react";
import type { SocialPublishDraft } from "../../lib/socialPublishTypes";
import {
  HOME_COMPOSER_FORMAT_LABELS,
  type HomeComposerFormat,
  type HomeComposerFormatResult
} from "../../lib/homeComposerTypes";
import { socialDraftToCopyText } from "../../lib/homeComposerFormatJobs";

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

function RunningCard({ format, progress }: { format: HomeComposerFormat; progress?: string }) {
  return (
    <div className="rounded-xl border border-line bg-fill/35 p-4">
      <div className="text-sm font-semibold text-ink">{HOME_COMPOSER_FORMAT_LABELS[format]} · 生成中</div>
      <p className="mt-2 text-sm text-muted">{progress || "排队中…"}</p>
    </div>
  );
}

function ErrorCard({ format, error }: { format: HomeComposerFormat; error: string }) {
  return (
    <div className="rounded-xl border border-danger/35 bg-danger/5 p-4">
      <div className="text-sm font-semibold text-danger-ink">{HOME_COMPOSER_FORMAT_LABELS[format]} · 生成失败</div>
      <p className="mt-2 text-sm text-danger-ink/90">{error}</p>
    </div>
  );
}

function XhsCard({
  draft,
  onCopyToast
}: {
  draft: SocialPublishDraft;
  onCopyToast?: (message: string) => void;
}) {
  const [titleIdx, setTitleIdx] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const onCopy = useCallback(
    (key: string, text: string, hint: HomeComposerFormat | "all") => {
      copyText(text, COPY_HINTS[hint], onCopyToast);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    },
    [onCopyToast]
  );

  return (
    <div className="rounded-xl border border-line bg-fill/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">小红书 · 可直接发布</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-fill"
            onClick={() => onCopy("body", draft.body, "xhs")}
          >
            {copiedKey === "body" ? "已复制" : "复制正文"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground hover:bg-brand/90"
            onClick={() => onCopy("all", socialDraftToCopyText(draft, titleIdx), "all")}
          >
            {copiedKey === "all" ? "已复制" : "复制全部"}
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">标题（点选）</p>
      <div className="mt-1 flex flex-col gap-1">
        {draft.titles.map((t, i) => (
          <button
            key={`${t}-${i}`}
            type="button"
            className={[
              "rounded-lg px-2.5 py-1.5 text-left text-sm transition",
              titleIdx === i ? "bg-brand/12 font-medium text-ink ring-1 ring-brand/30" : "text-ink hover:bg-fill"
            ].join(" ")}
            onClick={() => setTitleIdx(i)}
          >
            {titleIdx === i ? "● " : "○ "}
            {t}
          </button>
        ))}
      </div>
      <pre className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft.body}</pre>
    </div>
  );
}

function MpCard({ draft, onCopyToast }: { draft: SocialPublishDraft; onCopyToast?: (message: string) => void }) {
  const title = draft.titles[0] || draft.coverHook || "公众号稿件";
  const summary = draft.theme || draft.opening30 || "";
  const all = [title, summary, draft.body].filter(Boolean).join("\n\n");
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-fill/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">公众号 · 可直接发布</div>
        <button
          type="button"
          className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground hover:bg-brand/90"
          onClick={() => {
            copyText(all, COPY_HINTS.mp, onCopyToast);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? "已复制" : "复制全文"}
        </button>
      </div>
      <div className="mt-3 text-base font-semibold text-ink">{title}</div>
      {summary ? <p className="mt-1 text-xs text-muted">{summary}</p> : null}
      <pre className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft.body}</pre>
    </div>
  );
}

function ScriptCard({
  format,
  scriptText,
  onCopyToast
}: {
  format: "voice" | "podcast";
  scriptText: string;
  onCopyToast?: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const label = format === "voice" ? "口播脚本" : "播客大纲";
  const words = scriptText.replace(/\s/g, "").length;
  return (
    <div className="rounded-xl border border-line bg-fill/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-ink">{label}</div>
          <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-muted">{words} 字</span>
        </div>
        <button
          type="button"
          className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground hover:bg-brand/90"
          onClick={() => {
            copyText(scriptText, COPY_HINTS[format], onCopyToast);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? "已复制" : format === "voice" ? "复制脚本" : "复制大纲"}
        </button>
      </div>
      <pre className="mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink">{scriptText}</pre>
    </div>
  );
}

export default function HomeComposerFormatCard({ format, result, onCopyToast }: Props) {
  if (result.status === "pending" || result.status === "running") {
    return <RunningCard format={format} progress={result.progress} />;
  }
  if (result.status === "error") {
    return <ErrorCard format={format} error={result.error} />;
  }
  if (result.status !== "done") {
    return <ErrorCard format={format} error="未知状态" />;
  }
  if (result.social && (format === "xhs" || format === "mp")) {
    return format === "xhs" ? (
      <XhsCard draft={result.social} onCopyToast={onCopyToast} />
    ) : (
      <MpCard draft={result.social} onCopyToast={onCopyToast} />
    );
  }
  if (result.scriptText && (format === "voice" || format === "podcast")) {
    return <ScriptCard format={format} scriptText={result.scriptText} onCopyToast={onCopyToast} />;
  }
  return <ErrorCard format={format} error="任务已完成但未返回内容" />;
}
