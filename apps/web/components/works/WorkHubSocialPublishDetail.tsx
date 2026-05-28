"use client";

import { useState } from "react";
import { buildSocialPublishClipboardText, copyGuideLines } from "../../lib/socialPublishCopy";
import { platformLabel } from "../../lib/socialPublishPresets";
import type { SocialPublishWorkDetail } from "../../lib/socialPublishWorkDetail";
import { IconClipboard } from "../icons";

type Props = {
  detail: SocialPublishWorkDetail;
  jobGenerating?: boolean;
};

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line/80 bg-fill/35 px-3 py-2.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</h4>
      <div className="mt-1.5 text-[13px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

export function WorkHubSocialPublishDetail({ detail, jobGenerating = false }: Props) {
  const [copyHint, setCopyHint] = useState("");

  if (jobGenerating) {
    return (
      <section className="rounded-2xl border border-brand/25 bg-brand/10 px-4 py-4 text-sm text-brand">
        <p>正在生成 {platformLabel(detail.platform)} 发布稿…</p>
        <p className="mt-1 text-[12px] text-muted">
          完成后将在此显示备选标题、开头句、配图建议与正文，无需关闭本页。
        </p>
      </section>
    );
  }

  async function copyPack() {
    try {
      await navigator.clipboard.writeText(buildSocialPublishClipboardText(detail));
      setCopyHint("已复制发布包");
      window.setTimeout(() => setCopyHint(""), 2800);
    } catch {
      setCopyHint("复制失败，请检查浏览器权限");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">
          {platformLabel(detail.platform)} · 发布稿结构
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/15"
          onClick={() => void copyPack()}
        >
          <IconClipboard width={14} height={14} />
          复制发布包
        </button>
      </div>
      {copyHint ? <p className="text-[11px] text-success-ink">{copyHint}</p> : null}
      {detail.compliance ? (
        <p className="text-[11px] text-muted">{detail.compliance.userMessage}</p>
      ) : null}

      <FieldBlock label="备选标题（3 选 1）">
        <ol className="list-decimal space-y-1 pl-4">
          {detail.titles.map((t, i) => (
            <li key={`title-${i}`} className={i === detail.selectedTitleIndex ? "font-medium text-brand" : ""}>
              {t || "—"}
            </li>
          ))}
        </ol>
      </FieldBlock>

      {detail.coverHook ? (
        <FieldBlock label="封面钩子 / 列表标题">
          <p>{detail.coverHook}</p>
        </FieldBlock>
      ) : null}

      {detail.opening30 ? (
        <FieldBlock label="开头句（≤30 字）">
          <p>{detail.opening30}</p>
        </FieldBlock>
      ) : null}

      {detail.theme ? (
        <FieldBlock label="主题 / 一句话定位">
          <p>{detail.theme}</p>
        </FieldBlock>
      ) : null}

      {detail.tags && detail.tags.length > 0 ? (
        <FieldBlock label="话题标签">
          <p className="flex flex-wrap gap-1">
            {detail.tags.map((t) => (
              <span
                key={t}
                className="rounded border border-line/70 bg-canvas/80 px-1.5 py-0.5 text-[11px] text-ink"
              >
                #{t.replace(/^#/, "")}
              </span>
            ))}
          </p>
          <p className="mt-1 text-[10px] text-muted">完整话题行已并入下方正文末尾。</p>
        </FieldBlock>
      ) : null}

      {detail.imageSuggestions.length > 0 ? (
        <FieldBlock label="配图建议">
          <ul className="list-decimal space-y-1 pl-4">
            {detail.imageSuggestions.map((s, i) => (
              <li key={`img-${i}`}>{s}</li>
            ))}
          </ul>
        </FieldBlock>
      ) : null}

      <FieldBlock label="发布指引">
        <ol className="list-decimal space-y-0.5 pl-4 text-[12px] text-muted">
          {copyGuideLines(detail.platform).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </FieldBlock>
    </section>
  );
}
