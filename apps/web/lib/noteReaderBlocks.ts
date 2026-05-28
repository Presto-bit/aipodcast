/** 阅读器正文分块、PDF 页界、表格工作表锚点 */

import type { NotePageBreak } from "./noteReaderDisplayProfile";

export type NoteRenderBlock = {
  id: string;
  markdown: string;
  tocText?: string;
  tocLevel?: number;
  synthetic?: boolean;
  pageLabel?: string;
  sheetTitle?: string;
};

type StructuredRow = {
  id?: string;
  type?: string;
  text?: string;
  level?: number;
};

function normalizeStickyLines(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  const endPunct = /[。！？.!?;；:：]$/;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      out.push("");
      continue;
    }
    const prev = out.length ? out[out.length - 1] : "";
    const shouldJoin =
      !!prev &&
      prev.trim().length < 90 &&
      line.length < 120 &&
      !endPunct.test(prev.trim()) &&
      !/^([#>\-|*]|\d+\.)/.test(line);
    if (shouldJoin) out[out.length - 1] = `${prev.trim()} ${line}`;
    else out.push(line);
  }
  return out.join("\n");
}

function normalizeFromStored(items: StructuredRow[]): NoteRenderBlock[] {
  const out: NoteRenderBlock[] = [];
  for (const row of items) {
    const text = String(row?.text || "").trim();
    const typ = String(row?.type || "").trim().toLowerCase();
    const level = Number(row?.level || 0);
    if (!text) continue;
    const id = String(row?.id || `sb-${out.length + 1}`);
    if (typ === "heading" || typ === "h1" || typ === "h2" || typ === "h3") {
      const lv = level >= 1 && level <= 3 ? level : 2;
      out.push({ id, markdown: `${"#".repeat(lv)} ${text}`, tocText: text, tocLevel: lv });
    } else if (typ === "table" || typ === "table_row") {
      out.push({ id, markdown: text });
    } else if (typ === "image" || typ === "img") {
      out.push({ id, markdown: text.startsWith("![") ? text : `![image](${text})` });
    } else if (typ === "list_item" || typ === "li") {
      out.push({ id, markdown: text.startsWith("- ") ? text : `- ${text}` });
    } else {
      out.push({ id, markdown: text });
    }
  }
  return out;
}

function pushParagraph(target: NoteRenderBlock[], txt: string) {
  const t = txt.trim();
  if (!t) return;
  target.push({ id: `b-${target.length + 1}`, markdown: t });
}

/** structuredBlocks 是否含可用于目录的标题（无则改走正文分块/智能章节，避免 EPUB 仅段落块顶掉兜底） */
export function storedBlocksHaveTocHeadings(blocks: NoteRenderBlock[]): boolean {
  return blocks.some((b) => Boolean(b.tocText && b.tocLevel));
}

/** 后端 structuredBlocks 是否含章节标题（EPUB/PDF 等入库结构） */
export function structuredRowsHaveChapterHeadings(structuredBlocks?: StructuredRow[]): boolean {
  if (!Array.isArray(structuredBlocks) || structuredBlocks.length === 0) return false;
  return structuredBlocks.some((row) => {
    const typ = String(row?.type || "")
      .trim()
      .toLowerCase();
    return typ === "heading" || typ === "h1" || typ === "h2" || typ === "h3";
  });
}

/** 正文是否含后端写入的 Markdown 章节标题（如 EPUB ## 章节名） */
export function textHasChapterHeadings(text: string): boolean {
  return /^(#{1,3})\s+\S/im.test(String(text || ""));
}

/** 是否允许前端「智能章节」兜底（仅无任何后端/正文章节结构时） */
export function shouldUseSyntheticChapters(
  blocks: NoteRenderBlock[],
  structuredBlocks?: StructuredRow[],
  filteredText?: string
): boolean {
  if (blocks.some((b) => b.tocText && !b.synthetic)) return false;
  if (structuredRowsHaveChapterHeadings(structuredBlocks)) return false;
  if (textHasChapterHeadings(filteredText || "")) return false;
  return true;
}

export type BuildRenderBlocksOptions = {
  /** 资料扩展名，如 epub */
  sourceExt?: string;
};

function normalizeSourceExt(ext?: string): string {
  return String(ext || "")
    .trim()
    .toLowerCase();
}

/** 上传资料已有按段 structuredBlocks 时，优先直出、跳过粘行（与 EPUB 对齐） */
const PREFER_STORED_BLOCK_EXTS = new Set(["epub", "html", "htm", "xhtml", "docx", "doc"]);

export function prefersStoredStructuredBlocks(sourceExt?: string): boolean {
  return PREFER_STORED_BLOCK_EXTS.has(normalizeSourceExt(sourceExt));
}

function shouldPreferStoredStructuredBlocks(
  sourceExt: string,
  stored: NoteRenderBlock[]
): boolean {
  if (!prefersStoredStructuredBlocks(sourceExt) || stored.length === 0) return false;
  if (storedBlocksHaveTocHeadings(stored)) return true;
  const totalLen = stored.reduce((n, b) => n + (b.markdown?.length ?? 0), 0);
  return stored.length > 1 || totalLen < 12_000;
}

/** 已有段落结构时，不做粘行合并 */
export function shouldSkipStickyLineMerge(
  filteredText: string,
  structuredBlocks?: StructuredRow[],
  sourceExt?: string
): boolean {
  if (prefersStoredStructuredBlocks(sourceExt)) return true;
  if (structuredRowsHaveChapterHeadings(structuredBlocks)) return true;
  if (textHasChapterHeadings(filteredText)) return true;
  return (filteredText.match(/\n\n/g) || []).length >= 2;
}

export function buildRenderBlocksFromText(
  filteredText: string,
  structuredBlocks?: StructuredRow[],
  options?: BuildRenderBlocksOptions
): NoteRenderBlock[] {
  const sourceExt = normalizeSourceExt(options?.sourceExt);
  if (Array.isArray(structuredBlocks) && structuredBlocks.length > 0) {
    const stored = normalizeFromStored(structuredBlocks);
    if (shouldPreferStoredStructuredBlocks(sourceExt, stored)) {
      return stored;
    }
  }
  const normalized = shouldSkipStickyLineMerge(filteredText, structuredBlocks, sourceExt)
    ? String(filteredText || "").replace(/\r\n/g, "\n")
    : normalizeStickyLines(filteredText || "");
  const lines = normalized.split("\n");
  const out: NoteRenderBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] || "").trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const sheetMatch = /^##\s+工作表:\s*(.+)$/.exec(trimmed);
    if (sheetMatch) {
      const sheetTitle = sheetMatch[1].trim();
      out.push({
        id: `sheet-${out.length + 1}`,
        markdown: trimmed,
        tocText: sheetTitle,
        tocLevel: 2,
        sheetTitle
      });
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      out.push({
        id: `b-${out.length + 1}`,
        markdown: trimmed,
        tocText: heading[2].trim(),
        tocLevel: heading[1].length
      });
      i += 1;
      continue;
    }
    if (trimmed.startsWith("|")) {
      const table: string[] = [trimmed];
      i += 1;
      while (i < lines.length && (lines[i] || "").trim().startsWith("|")) {
        table.push((lines[i] || "").trim());
        i += 1;
      }
      out.push({ id: `b-${out.length + 1}`, markdown: table.join("\n") });
      continue;
    }
    if (/^(\- |\* |\d+\.\s+)/.test(trimmed)) {
      const list: string[] = [trimmed];
      i += 1;
      while (i < lines.length && /^(\- |\* |\d+\.\s+)/.test((lines[i] || "").trim())) {
        list.push((lines[i] || "").trim());
        i += 1;
      }
      out.push({ id: `b-${out.length + 1}`, markdown: list.join("\n") });
      continue;
    }
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const cur = (lines[i] || "").trim();
      if (!cur) break;
      if (/^(#{1,3})\s+/.test(cur) || cur.startsWith("|") || /^(\- |\* |\d+\.\s+)/.test(cur)) break;
      paraLines.push(cur);
      i += 1;
    }
    const paragraph = paraLines.join(" ");
    if (paragraph.length > 260) {
      const chunks = paragraph.split(/(?<=[。！？.!?；;])\s*/).filter(Boolean);
      if (chunks.length > 1) {
        let merged = "";
        for (const c of chunks) {
          const next = `${merged}${merged ? " " : ""}${c}`.trim();
          if (next.length >= 180) {
            pushParagraph(out, next);
            merged = "";
          } else {
            merged = next;
          }
        }
        if (merged) pushParagraph(out, merged);
        continue;
      }
    }
    pushParagraph(out, paragraph);
  }
  if (out.some((b) => b.tocText)) return out;
  if (!shouldUseSyntheticChapters(out, structuredBlocks, filteredText)) {
    return out;
  }
  const withSynthetic: NoteRenderBlock[] = [];
  let syntheticIndex = 0;
  let charAcc = 0;
  let sectionHint = "";
  for (const b of out) {
    const md = b.markdown.trim();
    if (!md) continue;
    charAcc += md.length;
    sectionHint += `${sectionHint ? " " : ""}${md.slice(0, 40)}`;
    if (charAcc >= 1200) {
      syntheticIndex += 1;
      const title = `章节 ${syntheticIndex} · ${(sectionHint || "内容").slice(0, 18)}`;
      withSynthetic.push({
        id: `s-${syntheticIndex}`,
        markdown: `## ${title}`,
        tocText: title,
        tocLevel: 2,
        synthetic: true
      });
      charAcc = 0;
      sectionHint = "";
    }
    withSynthetic.push(b);
  }
  return withSynthetic;
}

/** 在 UTF-16 偏移处插入 PDF 页界标记块 */
export function injectPageBreakBlocks(
  blocks: NoteRenderBlock[],
  fullText: string,
  pageBreaks: NotePageBreak[]
): NoteRenderBlock[] {
  if (!pageBreaks.length || !fullText) return blocks;
  const breaks = [...pageBreaks].sort((a, b) => a.charStart - b.charStart);
  let breakIdx = 0;
  let charOffset = 0;
  const out: NoteRenderBlock[] = [];
  for (const block of blocks) {
    const md = block.markdown || "";
    const blockStart = charOffset;
    const blockEnd = charOffset + md.length;
    while (breakIdx < breaks.length && breaks[breakIdx].charStart < blockEnd) {
      const br = breaks[breakIdx];
      if (br.charStart >= blockStart) {
        out.push({
          id: `page-${br.page}`,
          markdown: "",
          pageLabel: `第 ${br.page} 页`,
          synthetic: true
        });
      }
      breakIdx += 1;
    }
    out.push(block);
    charOffset = blockEnd + 2;
  }
  while (breakIdx < breaks.length) {
    const br = breaks[breakIdx];
    out.push({
      id: `page-${br.page}-tail`,
      markdown: "",
      pageLabel: `第 ${br.page} 页`,
      synthetic: true
    });
    breakIdx += 1;
  }
  return out;
}

export type SheetTab = { id: string; title: string };

export function extractSheetTabs(blocks: NoteRenderBlock[]): SheetTab[] {
  const tabs: SheetTab[] = [];
  for (const b of blocks) {
    if (!b.sheetTitle) continue;
    tabs.push({ id: b.id, title: b.sheetTitle });
  }
  return tabs;
}

/** 块是否自带 Markdown 标题（避免重复渲染 toc 行） */
export function blockHasInlineHeading(block: NoteRenderBlock): boolean {
  if (block.pageLabel) return false;
  const md = (block.markdown || "").trim();
  return /^(#{1,6})\s+/.test(md);
}
