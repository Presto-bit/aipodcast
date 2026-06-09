import type { ManuscriptBlock } from "./studioWorkTypes";

/** 流式/步骤 → 用户可见的语义进度 */
export function studioSemanticPhase(params: {
  runPhase?: string;
  tool?: "generate" | "revise";
  streamingBlocks?: ManuscriptBlock[] | null;
  searchingCorpus?: boolean;
}): string {
  if (params.searchingCorpus) return "搜索资料…";
  const phase = (params.runPhase || "").trim();
  if (/搜|资料|corpus/i.test(phase)) return "搜索资料…";
  if (/标题|title/i.test(phase)) return "正在写标题…";
  if (/正文|body|段落/i.test(phase)) return "正在写正文…";
  const blocks = params.streamingBlocks ?? [];
  const hasTitle = blocks.some((b) => b.kind === "title" && b.text.trim());
  const hasBody = blocks.some((b) => b.kind === "body" && b.text.trim());
  if (hasBody) return "正在写正文…";
  if (hasTitle) return "正在写标题…";
  if (params.tool === "revise") return "编辑中…";
  return phase || "写稿中…";
}
