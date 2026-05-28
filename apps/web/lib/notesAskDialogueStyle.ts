/** 知识库对话口吻：通用 / 本笔记本提炼风格 */

export type NotesAskDialogueStyleMode = "general" | "notebook";

export function defaultNotesAskDialogueStyle(hasNotebookStyle: boolean): NotesAskDialogueStyleMode {
  return hasNotebookStyle ? "notebook" : "general";
}

/** 输入区下方一行说明，帮助用户理解风格差异 */
export function notesAskDialogueStyleHint(
  mode: NotesAskDialogueStyleMode,
  hasNotebookStyle: boolean
): string {
  if (mode === "notebook" && hasNotebookStyle) {
    return "按本笔记本已提炼的口吻组织回答；事实仍只依据勾选资料，不会编造。";
  }
  if (hasNotebookStyle) {
    return "通用模式：客观、简洁的资料助手口吻，不套用笔记本风格。";
  }
  return "通用模式：客观、简洁，严格依据勾选资料作答。";
}

export function notesAskDialogueStyleLabel(
  mode: NotesAskDialogueStyleMode,
  notebookStyleName?: string
): string {
  if (mode === "notebook") {
    const name = (notebookStyleName || "本笔记本风格").trim() || "本笔记本风格";
    return name.length > 12 ? `${name.slice(0, 12)}…` : name;
  }
  return "通用模式";
}
