/** 知识库对话口吻：通用 / 本笔记本提炼风格 */

export type NotesAskDialogueStyleMode = "general" | "notebook";

export function defaultNotesAskDialogueStyle(hasNotebookStyle: boolean): NotesAskDialogueStyleMode {
  return hasNotebookStyle ? "notebook" : "general";
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
