"use client";

import { Button } from "../ui/Button";
import WorkspaceScrimModal from "../ui/WorkspaceScrimModal";
import type { ClipQcReport } from "../../lib/clipTypes";

type Props = {
  open: boolean;
  title: string;
  bodyIntro: string;
  hasReport: boolean;
  reportSummary: string;
  cancelLabel: string;
  analyzeLabel: string;
  skipExportLabel: string;
  busyAnalyze: boolean;
  busyExport: boolean;
  error: string | null;
  onCancel: () => void;
  onAnalyze: () => void;
  onSkipExport: () => void;
};

/**
 * 导出前听感质检门禁：可选立即分析、跳过直接导出、取消。
 */
export default function ClipExportQcGateModal({
  open,
  title,
  bodyIntro,
  hasReport,
  reportSummary,
  cancelLabel,
  analyzeLabel,
  skipExportLabel,
  busyAnalyze,
  busyExport,
  error,
  onCancel,
  onAnalyze,
  onSkipExport
}: Props) {
  const busy = busyAnalyze || busyExport;

  return (
    <WorkspaceScrimModal open={open} onClose={onCancel} busy={busy}>
      <div className="fym-modal-card relative z-[1] w-full max-w-md p-5" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{bodyIntro}</p>
        {hasReport && reportSummary ? (
          <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-line bg-canvas p-2 text-[10px] leading-relaxed text-ink">
            {reportSummary}
          </pre>
        ) : null}
        {error ? (
          <p className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-[11px] text-danger-ink" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="button" variant="secondary" disabled={busy} className="px-3 py-1.5 text-xs" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} className="px-3 py-1.5 text-xs" onClick={onAnalyze}>
            {busyAnalyze ? "…" : analyzeLabel}
          </Button>
          <Button type="button" variant="primary" disabled={busy} className="px-3 py-1.5 text-xs" onClick={onSkipExport}>
            {busyExport ? "…" : skipExportLabel}
          </Button>
        </div>
      </div>
    </WorkspaceScrimModal>
  );
}
