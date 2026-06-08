import { humanizeComposePhase } from "./studioAgentReadable";

export function studioComposeProgressLabel(params: {
  runPhase?: string;
  hasStream?: boolean;
  isRevise?: boolean;
}): string {
  if (params.hasStream) return "正在输出成稿…";
  const raw = (params.runPhase || "").trim();
  if (raw) return humanizeComposePhase(raw);
  return params.isRevise ? "改版中…" : "写稿中…";
}
