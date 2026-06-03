/** 小红书正文展示：拆段提升可读性 */

const MAX_PARA_CHARS = 88;

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

/** 将正文拆为适合 UI 渲染的段落列表 */
export function xhsBodyDisplayParagraphs(body: string): string[] {
  const normalized = (body || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const line = block.trim();
    if (!line) continue;
    if (line.startsWith("##")) {
      out.push(line.replace(/^#+\s*/, "").trim());
      continue;
    }
    if (line.startsWith("·") || line.startsWith("-") || line.startsWith("•")) {
      out.push(line);
      continue;
    }
    out.push(...splitLongParagraph(line));
  }
  return out;
}
