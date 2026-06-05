/** Studio 显式模式：问答（不动画布） vs 写稿（可 compose/revise） */
export type StudioAgentMode = "ask" | "write";

const STORAGE_KEY = "studio_agent_mode_v1";

export function getStudioAgentMode(): StudioAgentMode {
  if (typeof window === "undefined") return "write";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "ask" ? "ask" : "write";
}

export function setStudioAgentMode(mode: StudioAgentMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function studioAgentModeLabel(mode: StudioAgentMode): string {
  return mode === "ask" ? "问答" : "写稿";
}

export function studioAgentModePlaceholder(mode: StudioAgentMode, status: string): string {
  if (mode === "ask") {
    if (status === "generating") return "写稿进行中；问答模式仅解读与提问…";
    return "问运营、钩子、结构… 问答模式不会改动画布";
  }
  if (status === "generating") return "写稿进行中，仍可描述下一步改版…";
  if (status === "ready" || status === "shipped") return "问运营、解读稿件，或描述改版…";
  return "描述想创作的内容；信息够了会流式写稿…";
}
