import { phaseToGenerateStreamLine } from "./studioGenerateStream";
import { normalizeStudioRunPhase } from "./studioRunPhase";

export function studioComposeProgressLabel(params: {
  runPhase?: string;
  hasStream?: boolean;
  isRevise?: boolean;
}): string {
  if (params.hasStream) return "正在输出成稿…";
  const raw = (params.runPhase || "").trim();
  const normalized = normalizeStudioRunPhase(raw) || raw;
  if (normalized) return phaseToGenerateStreamLine(normalized);
  return params.isRevise ? "改版中…" : "写稿中…";
}
