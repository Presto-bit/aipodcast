/** 小红书正文展示：拆段提升可读性 */

const MAX_PARA_CHARS = 88;

/** 去掉 Markdown 语法，输出适合小红书发布的纯文本 */
export function xhsBodyPlainText(body: string): string {
  let text = (body || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^[\-*+]\s+/gm, "· ");
  text = text.replace(/^\d+\.\s+/gm, (m) => m);

  return text.trim();
}

function splitLongParagraph(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length <= MAX_PARA_CHARS) {
    return trimmed ? [trimmed] : [];
  }
  const parts: string[] = [];
  let buf = "";
  for (const seg of trimmed.split(/(?<=[。！？；])\s*/)) {
    const piece = seg.trim();
    if (!piece) continue;
    if ((buf + piece).length > MAX_PARA_CHARS && buf) {
      parts.push(buf.trim());
      buf = piece;
    } else {
      buf = buf ? `${buf}${piece}` : piece;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [trimmed];
}

function splitBlockForXhsDisplay(block: string): string[] {
  const line = block.trim();
  if (!line) return [];
  if (line.startsWith("·") || line.startsWith("-") || line.startsWith("•")) {
    return [line.replace(/^[\-*•]\s*/, "· ")];
  }
  if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(line)) {
    return [line];
  }
  if (line.length > MAX_PARA_CHARS) {
    return splitLongParagraph(line);
  }
  const sentences = line.split(/(?<=[。！？；])\s*/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length >= 2 && line.length >= 36) {
    return sentences;
  }
  return [line];
}

/** 将正文拆为适合 UI 渲染的段落列表 */
export function xhsBodyDisplayParagraphs(body: string): string[] {
  const normalized = xhsBodyPlainText(body);
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    out.push(...splitBlockForXhsDisplay(block));
  }
  return out;
}
