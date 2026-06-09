import { humanizeComposePhase } from "./studioAgentReadable";
import type { ManuscriptBlock } from "./studioWorkTypes";

function hasComposeStreamContent(
  blocks: ManuscriptBlock[] | null | undefined,
  bodyText?: string | null
): boolean {
  if (bodyText?.trim()) return true;
  return (blocks ?? []).some(
    (b) => (b.kind === "title" || b.kind === "body") && b.text.trim()
  );
}

/** 流式/步骤 → 用户可见的语义进度（时间线 / 状态条） */
export function studioSemanticPhase(params: {
  runPhase?: string;
  tool?: "generate" | "revise";
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  searchingCorpus?: boolean;
}): string {
  if (params.searchingCorpus) return "搜索资料…";
  const phase = (params.runPhase || "").trim();
  if (/搜|资料|corpus/i.test(phase)) return "搜索资料…";
  if (hasComposeStreamContent(params.streamingBlocks, params.streamingBodyText)) {
    return "正在输出成稿…";
  }
  if (phase) return humanizeComposePhase(phase);
  return params.tool === "revise" ? "改版中…" : "写稿中…";
}
