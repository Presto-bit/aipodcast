/**
 * 将「向资料提问」的纯文本回答规范化：段间空行保留为段落，段内单行换行转为 Markdown 硬换行，便于阅读。
 */
export function normalizeNotesAskAnswerForDisplay(raw: string): string {
  return raw
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/([^\n])\n(?=[^\n])/g, "$1  \n").trim())
    .join("\n\n");
}
