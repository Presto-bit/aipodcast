/**
 * 将「向资料提问」的纯文本回答规范化：段间空行保留为段落，段内单行换行转为 Markdown 硬换行，便于阅读。
 */
import { GENERAL_REFERENCE_HEADING_RE } from "./notesAskGeneralReference";

const STIFF_HEADING_RE = /^#{1,3}\s*(可执行结论|开篇结论|直接结论)\s*$/gm;

const SUPPLEMENT_DISMISS_RE =
  /资料已足够|无需补充|不必补充|不需要补充|无须补充|已足够回答/i;

/** 模型判定「无需补充」时的内部文案，不向用户展示 */
export function isDismissedNotesAskSupplement(raw: string): boolean {
  const t = String(raw || "").trim();
  if (!t) return true;
  if (t.includes("[[NO_SUPPLEMENT]]")) return true;
  const body = t.replace(GENERAL_REFERENCE_HEADING_RE, "").trim();
  if (!body) return true;
  if (SUPPLEMENT_DISMISS_RE.test(body) && body.length < 220) return true;
  const lines = body.split("\n").map((ln) => ln.trim()).filter(Boolean);
  if (lines.length <= 2 && SUPPLEMENT_DISMISS_RE.test(body)) return true;
  return false;
}

/** 资料正文 + 通识参考（合并为同一文稿区展示，如保存到自媒体素材） */
export function buildNotesAskAnswerBody(
  content: string,
  supplementContent?: string
): string {
  const parts: string[] = [];
  const main = String(content || "").trim();
  if (main) parts.push(main);
  const sup = String(supplementContent || "").trim();
  if (sup && !isDismissedNotesAskSupplement(sup)) parts.push(sup);
  return parts.join("\n\n");
}

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
