import type { NotePageBreak } from "./noteReaderDisplayProfile";
import type { NoteRenderBlock } from "./noteReaderBlocks";

export type TocEntry = {
  /** scroll-spy / DOM：块级锚点 */
  blockId: string;
  text: string;
  level: number;
  page?: number;
};

export function pageForCharOffset(pageBreaks: NotePageBreak[], offset: number): number | undefined {
  if (!pageBreaks.length) return undefined;
  let page: number | undefined;
  for (const pb of pageBreaks) {
    if (pb.charStart <= offset) page = pb.page;
    else break;
  }
  return page;
}

/** 为块计算在全文中的起始偏移（近似，用于 PDF 页码） */
export function blockCharOffsets(blocks: NoteRenderBlock[], fullText: string): Map<string, number> {
  const map = new Map<string, number>();
  let offset = 0;
  for (const b of blocks) {
    map.set(b.id, offset);
    const md = b.markdown || "";
    offset += md.length + 2;
  }
  if (fullText && blocks.length === 1) {
    map.set(blocks[0].id, 0);
  }
  return map;
}

/** 过滤 EPUB 内部文件名式目录项（part0000 等） */
export function isBoilerplateTocTitle(text: string): boolean {
  const compact = String(text || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\(\d+\)$/, "");
  if (!compact) return true;
  if (/^part\d+$/i.test(compact)) return true;
  if (/^chapter\d+$/i.test(compact)) return true;
  return false;
}

export function buildTocEntries(
  blocks: NoteRenderBlock[],
  opts: {
    pageBreaks?: NotePageBreak[];
    fullText?: string;
    max?: number;
    /** EPUB：仅保留 spine 级 ##（level 2）章节，避免章内小标题刷屏 */
    epubSpineOnly?: boolean;
  }
): TocEntry[] {
  const max = opts.max ?? 36;
  const offsets = blockCharOffsets(blocks, opts.fullText || "");
  const out: TocEntry[] = [];
  const seenTitles = new Set<string>();
  for (const b of blocks) {
    if (!b.tocText || !b.tocLevel || b.pageLabel) continue;
    if (opts.epubSpineOnly && b.tocLevel !== 2) continue;
    if (isBoilerplateTocTitle(b.tocText)) continue;
    const dedupeKey = b.tocText.trim().toLowerCase();
    if (seenTitles.has(dedupeKey)) continue;
    seenTitles.add(dedupeKey);
    const entry: TocEntry = {
      blockId: b.id,
      text: b.tocText,
      level: b.tocLevel
    };
    const off = offsets.get(b.id);
    if (typeof off === "number" && opts.pageBreaks?.length) {
      const p = pageForCharOffset(opts.pageBreaks, off);
      if (p) entry.page = p;
    }
    out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

export function tocNavLabel(ext: string | undefined, isEpub: boolean): string {
  if (isEpub || (ext || "").toLowerCase() === "epub") return "章节";
  return "目录";
}
