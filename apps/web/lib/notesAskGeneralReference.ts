/** 知识库对话「通识参考」块：与编排器 notes_ask_supplement 标题对齐 */

export const NOTES_ASK_GENERAL_REFERENCE_HEADING =
  "## 通识参考（非资料原文，请自行核实）";

export const NOTES_ASK_GENERAL_REFERENCE_DISCLAIMER =
  "以下由 AI 根据通识生成，未写入你的参考资料，可能与笔记本内容冲突，请自行核实。";

/** 资料覆盖偏弱、尚未生成通识块时的提示 */
export const NOTES_ASK_LOW_CONFIDENCE_HINT =
  "本轮检索与资料关联较弱：上方为资料摘录能支持的部分；若未覆盖你的问题，稍后将尝试追加通识参考，或请换问法、补充资料。";

export const GENERAL_REFERENCE_HEADING_RE = /^#+\s*(?:通识参考|补充说明)[^\n]*\n+/m;

const GENERAL_REF_TOAST_KEY = "fym_notes_ask_general_ref_toast_seen";

export function shouldShowGeneralReferenceToast(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GENERAL_REF_TOAST_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markGeneralReferenceToastSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GENERAL_REF_TOAST_KEY, "1");
  } catch {
    /* ignore */
  }
}
