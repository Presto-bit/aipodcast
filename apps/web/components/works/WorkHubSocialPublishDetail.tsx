"use client";

import { useState, type ReactNode } from "react";
import { buildSocialPublishClipboardText } from "../../lib/socialPublishCopy";
import { platformLabel } from "../../lib/socialPublishPresets";
import type { SocialPublishWorkDetail } from "../../lib/socialPublishWorkDetail";
import { IconClipboard } from "../icons";

type Props = {
  detail: SocialPublishWorkDetail;
  jobGenerating?: boolean;
};

function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line/80 bg-fill/35 px-3 py-2.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</h4>
      <div className="mt-1.5 text-[13px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/** 自媒体稿详情元信息：仅保留标题备选与主题，正文/配图见下方文稿区。 */
export function WorkHubSocialPublishDetail({ detail, jobGenerating = false }: Props) {
  const [copyHint, setCopyHint] = useState("");

  if (jobGenerating) {
    return (
      <section className="rounded-2xl border border-brand/25 bg-brand/10 px-4 py-4 text-sm text-brand">
        <p>正在生成 {platformLabel(detail.platform)} 发布稿…</p>
        <p className="mt-1 text-[12px] text-muted">完成后将在此显示标题备选与正文，无需关闭本页。</p>
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
        <p className="text-xs font-medium text-ink">{platformLabel(detail.platform)} · 发布稿</p>
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
      {detail.compliance ? <p className="text-[11px] text-muted">{detail.compliance.userMessage}</p> : null}

      <FieldBlock label="备选标题（3 选 1）">
        <ol className="list-decimal space-y-1 pl-4">
          {detail.titles.map((t, i) => (
            <li key={`title-${i}`} className={i === detail.selectedTitleIndex ? "font-medium text-brand" : ""}>
              {t || "—"}
            </li>
          ))}
        </ol>
      </FieldBlock>

      {detail.theme ? (
        <FieldBlock label="主题 / 一句话定位">
          <p>{detail.theme}</p>
        </FieldBlock>
      ) : null}
    </section>
  );
}
