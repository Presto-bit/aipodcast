"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../lib/I18nProvider";
import {
  CLIP_EXPORT_QUALITY_PRESETS,
  exportOptionsFromPreset,
  lameQFromExportOptions,
  normalizeExportOptions,
  presetFromLameQ,
  type ClipExportOptions,
  type ClipExportQualityPreset
} from "../../lib/clipExportQuality";

type Props = {
  projectId: string;
  exportOptions: ClipExportOptions | null | undefined;
  getAuthHeaders: () => Record<string, string>;
  disabled?: boolean;
  onUpdated?: (opts: ClipExportOptions) => void;
  onError?: (msg: string) => void;
  className?: string;
};

export default function ClipExportQualitySelect({
  projectId,
  exportOptions,
  getAuthHeaders,
  disabled = false,
  onUpdated,
  onError,
  className = ""
}: Props) {
  const { t } = useI18n();
  const normalized = normalizeExportOptions(exportOptions);
  const [preset, setPreset] = useState<ClipExportQualityPreset>(presetFromLameQ(lameQFromExportOptions(normalized)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreset(presetFromLameQ(lameQFromExportOptions(normalizeExportOptions(exportOptions))));
  }, [exportOptions]);

  const labelFor = useCallback(
    (id: ClipExportQualityPreset) => {
      if (id === "max") return t("clip.editor.exportQualityMax");
      if (id === "standard") return t("clip.editor.exportQualityStandard");
      return t("clip.editor.exportQualityHigh");
    },
    [t]
  );

  const savePreset = useCallback(
    async (next: ClipExportQualityPreset) => {
      const opts = exportOptionsFromPreset(next);
      setPreset(next);
      setBusy(true);
      try {
        const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ export_options: opts })
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
        if (!res.ok || data.success === false) {
          throw new Error(data.detail || `保存失败 ${res.status}`);
        }
        onUpdated?.(opts);
      } catch (e) {
        setPreset(presetFromLameQ(lameQFromExportOptions(normalized)));
        onError?.(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
      }
    },
    [getAuthHeaders, normalized, onError, onUpdated, projectId]
  );

  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-muted ${className}`.trim()}>
      <span className="shrink-0">{t("clip.editor.exportQuality")}</span>
      <select
        className="max-w-[8.5rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink disabled:opacity-40"
        value={preset}
        disabled={disabled || busy}
        aria-label={t("clip.editor.exportQuality")}
        onChange={(e) => void savePreset(e.target.value as ClipExportQualityPreset)}
      >
        {CLIP_EXPORT_QUALITY_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {labelFor(p.id)}
          </option>
        ))}
      </select>
    </label>
  );
}
