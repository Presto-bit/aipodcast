"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import type { ClipProjectRow } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";

/** 与编排器 PATCH 校验一致：[-24, -10]；UI 提供常见播客 / 流媒体档位 */
const LOUDNESS_PRESETS = [-23, -18, -16, -14, -12] as const;

function isDualTrackInterview(ch: unknown): boolean {
  return Array.isArray(ch) && ch.length >= 2;
}

function RepairCollapsibleSection({
  title,
  open,
  onToggle,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-fill/25">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-ink transition hover:bg-fill/40"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        )}
        <span className="min-w-0 flex-1 leading-snug">{title}</span>
      </button>
      {open ? <div className="border-t border-line/60 px-3 pb-3 pt-1">{children}</div> : null}
    </section>
  );
}

type Props = {
  projectId: string;
  project: ClipProjectRow;
  getAuthHeaders: () => Record<string, string>;
  transcriptionStatus: string;
  onRefreshProject: () => Promise<void>;
  onProjectUpdated: (p: ClipProjectRow) => void;
  onError: (msg: string) => void;
};

export default function ClipRepairPanel({
  projectId,
  project,
  getAuthHeaders,
  transcriptionStatus,
  onRefreshProject,
  onProjectUpdated,
  onError
}: Props) {
  const { t } = useI18n();
  const [busyKind, setBusyKind] = useState<"" | "ambient" | "loudnorm" | "dual_balance">("");
  const [loudnessTargetBusy, setLoudnessTargetBusy] = useState(false);
  const [ambientOpen, setAmbientOpen] = useState(false);
  const [dualBalanceOpen, setDualBalanceOpen] = useState(false);
  const [loudnessOpen, setLoudnessOpen] = useState(false);
  const busy = busyKind !== "";
  const blocked = transcriptionStatus === "running" || transcriptionStatus === "queued";
  const noAudio = !project.has_audio && !project.audio_download_url;

  const loudnessSelectValue =
    project.repair_loudness_i_lufs !== null && project.repair_loudness_i_lufs !== undefined
      ? String(Number(project.repair_loudness_i_lufs))
      : "";

  const dualTrack = isDualTrackInterview(project.channel_ids);

  const patchLoudnessTarget = useCallback(
    async (next: number | null) => {
      setLoudnessTargetBusy(true);
      onError("");
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ repair_loudness_i_lufs: next })
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          project?: ClipProjectRow;
          detail?: string;
        };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存失败 ${res.status}`);
        }
        if (data.project) onProjectUpdated(data.project);
        await onRefreshProject();
      } catch (e) {
        onError(String(e instanceof Error ? e.message : e));
      } finally {
        setLoudnessTargetBusy(false);
      }
    },
    [getAuthHeaders, onError, onProjectUpdated, onRefreshProject, projectId]
  );

  async function runRepair(kind: "ambient" | "loudnorm" | "dual_balance") {
    if (blocked || noAudio || busy) return;
    setBusyKind(kind);
    onError("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/repair`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ kind })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        project?: ClipProjectRow;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `修音失败 ${res.status}`);
      }
      if (data.project) onProjectUpdated(data.project);
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyKind("");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-2 text-[12px] leading-relaxed text-ink">
      <p className="text-[10px] text-muted">{t("presto.flow.repair.intro")}</p>

      <RepairCollapsibleSection
        title={t("presto.flow.repair.ambientTitle")}
        open={ambientOpen}
        onToggle={() => setAmbientOpen((o) => !o)}
      >
        <p className="text-[11px] text-muted">{t("presto.flow.repair.ambientBody")}</p>
        <button
          type="button"
          disabled={blocked || noAudio || busy}
          className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-[11px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-45"
          onClick={() => void runRepair("ambient")}
        >
          {busyKind === "ambient" ? "…" : t("presto.flow.repair.applyAmbient")}
        </button>
      </RepairCollapsibleSection>

      <RepairCollapsibleSection
        title={t("presto.flow.repair.dualBalanceTitle")}
        open={dualBalanceOpen}
        onToggle={() => setDualBalanceOpen((o) => !o)}
      >
        <p className="text-[11px] text-muted">{t("presto.flow.repair.dualBalanceBody")}</p>
        {!dualTrack && !noAudio ? (
          <p className="mt-2 text-[10px] text-warning-ink">{t("presto.flow.repair.dualBalanceNeedStereo")}</p>
        ) : null}
        <button
          type="button"
          disabled={blocked || noAudio || busy || !dualTrack}
          className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-[11px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-45"
          onClick={() => void runRepair("dual_balance")}
        >
          {busyKind === "dual_balance" ? "…" : t("presto.flow.repair.applyDualBalance")}
        </button>
      </RepairCollapsibleSection>

      <RepairCollapsibleSection
        title={t("presto.flow.repair.loudnessTitle")}
        open={loudnessOpen}
        onToggle={() => setLoudnessOpen((o) => !o)}
      >
        <p className="text-[11px] text-muted">{t("presto.flow.repair.loudnessBody")}</p>
        <label className="mt-3 block text-[10px] font-medium text-muted">
          {t("presto.flow.repair.loudnessTargetLabel")}
          <select
            className="mt-1 w-full max-w-xs rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink disabled:opacity-45"
            disabled={loudnessTargetBusy || busy}
            value={loudnessSelectValue}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") void patchLoudnessTarget(null);
              else void patchLoudnessTarget(Number(raw));
            }}
          >
            <option value="">{t("presto.flow.repair.loudnessTargetDefault")}</option>
            {LOUDNESS_PRESETS.map((n) => (
              <option key={n} value={String(n)}>
                {n} LUFS
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-[10px] leading-snug text-muted">{t("presto.flow.repair.loudnessTargetHint")}</p>
        <button
          type="button"
          disabled={blocked || noAudio || busy}
          className="mt-3 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-[11px] font-semibold text-brand hover:bg-brand/15 disabled:opacity-45"
          onClick={() => void runRepair("loudnorm")}
        >
          {busyKind === "loudnorm" ? "…" : t("presto.flow.repair.applyLoudness")}
        </button>
      </RepairCollapsibleSection>

      {blocked ? <p className="text-[10px] text-warning-ink">{t("presto.flow.repair.blockedTranscribing")}</p> : null}
      {noAudio ? <p className="text-[10px] text-muted">{t("presto.flow.repair.needAudio")}</p> : null}
    </div>
  );
}
