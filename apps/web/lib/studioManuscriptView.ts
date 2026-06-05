import type { ManuscriptBlock } from "./studioWorkTypes";

export type TitleBlock = Extract<ManuscriptBlock, { kind: "title" }>;

export function manuscriptTitleBlocks(blocks: ManuscriptBlock[]): TitleBlock[] {
  return blocks.filter((b): b is TitleBlock => b.kind === "title");
}

export function resolvePrimaryTitleIndex(version: { primaryTitleIndex?: number } | null, titleCount: number): number {
  const idx = version?.primaryTitleIndex ?? 0;
  if (titleCount <= 0) return 0;
  return Math.max(0, Math.min(idx, titleCount - 1));
}

export function resolvePrimaryTitle(blocks: ManuscriptBlock[], titleIndex: number): string {
  const titles = manuscriptTitleBlocks(blocks);
  return titles[titleIndex]?.text ?? titles[0]?.text ?? "";
}

/** 正文中的资料锚点标记（与生成 prompt 约定一致） */
const CORPUS_ANCHOR_RE = /\[资料\d?\]|资料中提到|根据所选资料|笔记里提到/g;

export function bodyHasCorpusAnchors(text: string): boolean {
  return CORPUS_ANCHOR_RE.test(text);
}

export function splitXhsBodyParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
