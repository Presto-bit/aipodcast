"use client";

import { useState } from "react";
import type { ClipQcReport } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";

type Props = {
  projectId: string;
  getAuthHeaders: () => Record<string, string>;
  qcReport: ClipQcReport | null | undefined;
  onRefreshProject: () => Promise<void>;
  onError: (msg: string) => void;
};

/** 工作台「听感质检」独立 Tab：与工程页解耦，数据来自工程行 qc_report。 */
export default function ClipQcWorkbenchPanel({ projectId, getAuthHeaders, qcReport, onRefreshProject, onError }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const runQc = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/qc/analyze`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `质检失败 ${res.status}`);
      }
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 text-[12px]">
      <p className="text-muted">{t("presto.flow.studio.qcIntro")}</p>
      <button
        type="button"
        disabled={busy}
        className="w-fit rounded-lg border border-line bg-fill px-3 py-2 text-[11px] font-semibold text-ink hover:bg-fill/80 disabled:opacity-50"
        onClick={() => void runQc()}
      >
        {busy ? "…" : t("presto.flow.studio.runQc")}
      </button>
      {qcReport ? (
        <pre className="max-h-[min(320px,50vh)] overflow-auto rounded-lg border border-line bg-canvas p-2 text-[10px] leading-relaxed text-ink">
          {JSON.stringify(qcReport, null, 2)}
        </pre>
      ) : (
        <p className="text-muted">{t("presto.flow.studio.qcEmpty")}</p>
      )}
    </div>
  );
}
