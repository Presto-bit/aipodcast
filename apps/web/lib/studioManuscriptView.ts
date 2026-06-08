import type { ManuscriptBlock } from "./studioWorkTypes";

export type TitleBlock = Extract<ManuscriptBlock, { kind: "title" }>;
export type BodyBlock = Extract<ManuscriptBlock, { kind: "body" }>;

export function manuscriptTitleBlocks(blocks: ManuscriptBlock[]): TitleBlock[] {
  return blocks.filter((b): b is TitleBlock => b.kind === "title");
}

export function manuscriptBodyBlocks(blocks: ManuscriptBlock[]): BodyBlock[] {
  return blocks.filter((b): b is BodyBlock => b.kind === "body");
}

/** 按 best-of 下标取对应正文；兼容旧稿单 body 块 */
export function resolveBodyForTitleIndex(
  blocks: ManuscriptBlock[],
  titleIndex: number
): BodyBlock | undefined {
  const indexed = blocks.find(
    (b): b is BodyBlock => b.kind === "body" && b.id === `body-${titleIndex}`
  );
  if (indexed) return indexed;
  const bodies = manuscriptBodyBlocks(blocks);
  if (bodies.length > 1) return bodies[titleIndex] ?? bodies[0];
  return bodies[0];
}

/** 按 best-of 下标取话题；兼容旧稿单个 hashtags 块 */
export function resolveHashtagsForTitleIndex(
  blocks: ManuscriptBlock[],
  titleIndex: number
): string[] {
  const indexed = blocks.find(
    (b): b is Extract<ManuscriptBlock, { kind: "hashtags" }> =>
      b.kind === "hashtags" && b.id === `hashtags-${titleIndex}`
  );
  if (indexed) return indexed.tags;
  const shared = blocks.find((b): b is Extract<ManuscriptBlock, { kind: "hashtags" }> => b.kind === "hashtags");
  return shared?.tags ?? [];
}

export function resolveInteractionForTitleIndex(
  blocks: ManuscriptBlock[],
  titleIndex: number
): string {
  const indexed = blocks.find(
    (b): b is Extract<ManuscriptBlock, { kind: "interaction" }> =>
      b.kind === "interaction" && b.id === `interaction-${titleIndex}`
  );
  if (indexed) return indexed.text;
  const shared = blocks.find((b): b is Extract<ManuscriptBlock, { kind: "interaction" }> => b.kind === "interaction");
  return shared?.text ?? "";
}

export type ManuscriptVariantSlice = {
  title: string;
  body: string;
  hashtags: string[];
  interaction: string;
  cover: string;
};

export function resolveManuscriptVariant(
  blocks: ManuscriptBlock[],
  titleIndex: number
): ManuscriptVariantSlice {
  const titles = manuscriptTitleBlocks(blocks);
  const active =
    titles.length > 0 ? Math.max(0, Math.min(titleIndex, titles.length - 1)) : 0;
  const title = titles[active]?.text ?? titles[0]?.text ?? "";
  const body = resolveBodyForTitleIndex(blocks, active)?.text ?? "";
  const cover = blocks.find((b) => b.kind === "coverBrief");
  return {
    title,
    body,
    hashtags: resolveHashtagsForTitleIndex(blocks, active),
    interaction: resolveInteractionForTitleIndex(blocks, active),
    cover: cover && cover.kind === "coverBrief" ? cover.text : ""
  };
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

/** 与生成 prompt 约定的 3 个标题方向（痛点 / 好奇 / 数字） */
export const STUDIO_TITLE_DIRECTION_LABELS = ["痛点向", "好奇向", "数字向"] as const;

export function studioTitleDirectionLabel(index: number): string {
  return STUDIO_TITLE_DIRECTION_LABELS[index] ?? `方向 ${index + 1}`;
}

/** 展示用：折叠换行为空格，避免成稿被段落/区块拆开 */
export function flattenManuscriptDisplayText(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").trim();
}

export function buildManuscriptFlowText(parts: {
  title?: string;
  body?: string;
  hashtags?: string[];
  interaction?: string;
  cover?: string;
  includeTitle?: boolean;
}): string {
  const segments: string[] = [];
  if (parts.includeTitle !== false && parts.title?.trim()) segments.push(parts.title.trim());
  if (parts.body?.trim()) segments.push(flattenManuscriptDisplayText(parts.body));
  if (parts.interaction?.trim()) segments.push(flattenManuscriptDisplayText(parts.interaction));
  if (parts.hashtags?.length) {
    segments.push(parts.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" "));
  }
  if (parts.cover?.trim()) {
    segments.push(`封面：${flattenManuscriptDisplayText(parts.cover)}`);
  }
  return segments.join(" ");
}
