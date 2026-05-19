/**
 * 将「向资料提问」的纯文本回答规范化：段间空行保留为段落，段内单行换行转为 Markdown 硬换行，便于阅读。
 */
const STIFF_HEADING_RE = /^#{1,3}\s*(可执行结论|开篇结论|直接结论)\s*$/gm;

export function normalizeNotesAskAnswerForDisplay(raw: string): string {
  return raw
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(STIFF_HEADING_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/([^\n])\n(?=[^\n])/g, "$1  \n").trim())
    .filter(Boolean)
    .join("\n\n");
}
