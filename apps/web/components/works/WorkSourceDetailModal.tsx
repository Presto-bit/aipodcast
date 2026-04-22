"use client";

import FormSheetModal from "../subscription/FormSheetModal";
import type { WorkSourceModalModel } from "../../lib/workDetailMeta";

type Props = {
  open: boolean;
  model: WorkSourceModalModel;
  onClose: () => void;
};

function Block({ title, body }: { title: string; body: string }) {
  if (!body.trim()) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <p className="whitespace-pre-wrap rounded-lg border border-line bg-fill/30 p-2 text-xs leading-relaxed text-ink">{body}</p>
    </section>
  );
}

export function WorkSourceDetailModal({ open, model, onClose }: Props) {
  return (
    <FormSheetModal open={open} titleId="work-source-detail-title" title="创作来源与所用资料" onClose={onClose}>
      <div className="space-y-4 text-sm text-ink">
        <p className="rounded-lg border border-brand/25 bg-brand/10 p-3 text-xs leading-relaxed text-ink">{model.outlineNotice}</p>
        <Block title="节目 / 体裁" body={model.programName} />
        <Block title="核心问题" body={model.coreQuestion} />
        <Block title="撰稿约束" body={model.scriptConstraints} />
        <Block title="参考链接" body={model.url} />
        <Block title="附加说明（reference_extra）" body={model.referenceExtra} />
        {model.notebook ? (
          <Block title="笔记本" body={model.notebook} />
        ) : null}
        {model.noteTitles.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">引用笔记标题</h3>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-ink">
              {model.noteTitles.map((t, i) => (
                <li key={`${i}-${t.slice(0, 24)}`}>{t}</li>
              ))}
            </ol>
          </section>
        ) : null}
        {model.payloadTextPreview.trim() ? (
          <Block title="任务输入正文（节选）" body={model.payloadTextPreview} />
        ) : null}
        {model.referenceTextsPreview.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">参考文本片段（节选）</h3>
            {model.referenceTextsPreview.map((t, i) => (
              <p
                key={i}
                className="whitespace-pre-wrap rounded-lg border border-line bg-fill/30 p-2 text-xs leading-relaxed text-ink"
              >
                {t}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </FormSheetModal>
  );
}
