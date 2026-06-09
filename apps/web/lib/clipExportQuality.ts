/** 剪辑导出音质选项（LAME VBR q，与 orchestrator export_options 对齐） */

export type ClipExportQualityPreset = "high" | "max" | "standard";

export type ClipExportOptions = {
  encoding: { lame_q: number };
};

export const CLIP_EXPORT_QUALITY_PRESETS: ReadonlyArray<{
  id: ClipExportQualityPreset;
  lameQ: number;
}> = [
  { id: "high", lameQ: 2 },
  { id: "max", lameQ: 0 },
  { id: "standard", lameQ: 4 }
];

export function lameQFromExportOptions(raw: ClipExportOptions | null | undefined): number {
  const q = raw?.encoding?.lame_q;
  if (typeof q === "number" && Number.isFinite(q)) return Math.max(0, Math.min(9, Math.round(q)));
  return 2;
}

export function presetFromLameQ(lameQ: number): ClipExportQualityPreset {
  if (lameQ <= 1) return "max";
  if (lameQ >= 4) return "standard";
  return "high";
}

export function exportOptionsFromPreset(preset: ClipExportQualityPreset): ClipExportOptions {
  const row = CLIP_EXPORT_QUALITY_PRESETS.find((p) => p.id === preset);
  return { encoding: { lame_q: row?.lameQ ?? 2 } };
}

export function normalizeExportOptions(raw: unknown): ClipExportOptions {
  if (raw && typeof raw === "object" && raw !== null) {
    const enc = (raw as ClipExportOptions).encoding;
    if (enc && typeof enc.lame_q === "number") {
      return exportOptionsFromPreset(presetFromLameQ(enc.lame_q));
    }
  }
  return exportOptionsFromPreset("high");
}
