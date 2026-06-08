import { humanizeComposePhase } from "./studioAgentReadable";

export type ComposeProgressParams = {
  runPhase?: string;
  hasStream?: boolean;
  isRevise?: boolean;
};

/** 流式成稿区：有正文时不重复 phase 文案（进度由光标/内容体现） */
export function studioStreamPhaseLabel(params: ComposeProgressParams): string {
  if (params.hasStream) return "";
  const raw = (params.runPhase || "").trim();
  if (raw) return humanizeComposePhase(raw);
  return params.isRevise ? "改版中…" : "写稿中…";
}

/** 输入框 footer：流式开始后交给成稿区展示，避免重复 */
export function studioComposerProgressLabel(params: ComposeProgressParams): string | undefined {
  if (params.hasStream) return undefined;
  const label = studioStreamPhaseLabel(params);
  return label || undefined;
}

/** @deprecated 使用 studioStreamPhaseLabel / studioComposerProgressLabel */
export function studioComposeProgressLabel(params: ComposeProgressParams): string {
  return studioStreamPhaseLabel(params);
}
