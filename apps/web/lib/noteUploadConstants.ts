/** 与 `services/orchestrator/app/note_constants.py` 保持一致 */
export const MAX_NOTE_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_NOTE_EXT = new Set(["txt", "md", "markdown", "pdf", "doc", "docx", "epub"]);

/**
 * 浏览器端前置校验，减少无效大包请求。
 */
export function validateNoteFileMeta(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size === 0) {
    return { ok: false, error: "不能上传空文件" };
  }
  if (file.size > MAX_NOTE_UPLOAD_BYTES) {
    return { ok: false, error: `文件过大（请 ≤ ${Math.round(MAX_NOTE_UPLOAD_BYTES / (1024 * 1024))}MB）` };
  }
  let name = (file.name || "note.txt").trim() || "note.txt";
  if (!name.includes(".")) {
    name = `${name}.txt`;
  }
  const ext = name.includes(".") ? (name.split(".").pop() || "").toLowerCase() : "";
  if (!ALLOWED_NOTE_EXT.has(ext)) {
    return { ok: false, error: "不支持的文件格式（支持 txt、md、pdf、doc、docx、epub）" };
  }
  return { ok: true };
}
