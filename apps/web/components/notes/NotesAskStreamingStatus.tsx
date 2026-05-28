"use client";

type Props = {
  phase?: string;
  reasoning?: string;
  /** 已有正式回答正文时，思考区默认折叠感更强 */
  hasAnswer?: boolean;
};

/**
 * 流式等待：展示检索/生成阶段文案与模型推理片段（若有）。
 */
export function NotesAskStreamingStatus({ phase, reasoning, hasAnswer = false }: Props) {
  const phaseLine = (phase || "").trim();
  const reasoningText = (reasoning || "").trim();
  if (!phaseLine && !reasoningText) {
    return <p className="text-sm text-muted">思考中…</p>;
  }

  return (
    <div className="space-y-2 text-sm">
      {phaseLine ? (
        <p className="flex items-center gap-2 text-muted">
          <span
            className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand/30 border-t-brand"
            aria-hidden
          />
          <span>{phaseLine}</span>
        </p>
      ) : null}
      {reasoningText ? (
        <div
          className={
            hasAnswer
              ? "border-l-2 border-line/80 pl-2.5 text-[12px] leading-relaxed text-muted"
              : "text-[12px] leading-relaxed text-muted"
          }
        >
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted/90">
            思考过程
          </p>
          <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words">{reasoningText}</div>
        </div>
      ) : null}
    </div>
  );
}
