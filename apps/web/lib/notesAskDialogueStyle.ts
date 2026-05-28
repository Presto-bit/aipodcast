/** 知识库对话口吻：通用 / 本笔记本提炼风格 */

export type NotesAskDialogueStyleMode = "general" | "notebook";

export function defaultNotesAskDialogueStyle(hasNotebookStyle: boolean): NotesAskDialogueStyleMode {
  return hasNotebookStyle ? "notebook" : "general";
}

/** 各风格选项下方的灰色说明（展示在选项标题下） */
export function notesAskDialogueStyleHint(mode: NotesAskDialogueStyleMode): string {
  if (mode === "notebook") {
    return "沿用笔记本口吻";
  }
  return "客观简洁。";
}

export function notesAskDialogueStyleLabel(mode: NotesAskDialogueStyleMode): string {
  if (mode === "notebook") {
    return "本笔记本风格";
  }
  return "通用模式";
}
