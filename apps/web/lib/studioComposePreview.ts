import type { ManuscriptBlock } from "./studioWorkTypes";

export type StudioComposePreview = {
  runId: string;
  blocks: ManuscriptBlock[];
  reason: "needs_brief" | "needs_rewrite";
};

/** 终检失败时：从流式缓冲或 done 块还原可展示的预览稿 */
export function blocksFromComposeStream(
  streamingBlocks: ManuscriptBlock[] | null,
  streamingBodyText: string | null,
  fallbackBlocks: ManuscriptBlock[] = []
): ManuscriptBlock[] {
  const base = streamingBlocks?.length
    ? streamingBlocks.map((b) => ({ ...b }))
    : fallbackBlocks.map((b) => ({ ...b }));
  const bodyText = streamingBodyText?.trim();
  if (!bodyText) return base;
  const idx = base.findIndex((b) => b.kind === "body");
  if (idx >= 0) {
    const row = base[idx]!;
    if (row.kind === "body") base[idx] = { ...row, text: bodyText };
    return base;
  }
  if (base.length) {
    base.push({ id: "body-0", kind: "body", text: bodyText, evidence: "model" });
    return base;
  }
  return [{ id: "body-0", kind: "body", text: bodyText, evidence: "model" }];
}

export function hasComposePreviewContent(blocks: ManuscriptBlock[]): boolean {
  return blocks.some(
    (b) => (b.kind === "body" && b.text.trim()) || (b.kind === "title" && b.text.trim())
  );
}
