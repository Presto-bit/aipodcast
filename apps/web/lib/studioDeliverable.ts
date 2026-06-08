import type { ExpertDeliverable } from "./homeComposerExpertTypes";
import type { ManuscriptBlock } from "./studioWorkTypes";
import { xhsBodyPlainText } from "./xhsBodyFormat";
import {
  buildManuscriptFlowText,
  resolveManuscriptVariant
} from "./studioManuscriptView";

export function deliverableToManuscriptBlocks(deliverable: ExpertDeliverable): ManuscriptBlock[] {
  if (deliverable.expertId !== "xhs_ops" || !("titles" in deliverable.content)) {
    return [];
  }
  const c = deliverable.content;
  const blocks: ManuscriptBlock[] = [];
  c.titles.forEach((t, i) => {
    const text = String(t || "").trim();
    if (text) blocks.push({ id: `title-${i}`, kind: "title", text, evidence: "model" });
  });
  const variantBodies = (c.bodies ?? [])
    .map((b) => xhsBodyPlainText(b))
    .filter(Boolean)
    .slice(0, 3);
  const corpusEvidence =
    deliverable.meta?.provenance?.corpusCoverage === "full" ||
    deliverable.meta?.provenance?.corpusCoverage === "partial";
  if (variantBodies.length) {
    variantBodies.forEach((text, i) => {
      blocks.push({
        id: `body-${i}`,
        kind: "body",
        text,
        evidence: corpusEvidence ? "corpus" : "model"
      });
    });
  } else {
    const body = xhsBodyPlainText(c.body);
    if (body) {
      blocks.push({
        id: "body-0",
        kind: "body",
        text: body,
        evidence: corpusEvidence ? "corpus" : "model"
      });
    }
  }
  const variantCount = Math.max(
    variantBodies.length,
    c.titles.length,
    (c.interactions ?? []).length,
    1
  );
  const sharedTags = (c.hashtags || []).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean);
  const interactions = (c.interactions ?? []).map((t) => String(t || "").trim()).filter(Boolean);
  for (let i = 0; i < Math.min(3, variantCount); i++) {
    if (sharedTags.length) {
      blocks.push({ id: `hashtags-${i}`, kind: "hashtags", tags: [...sharedTags] });
    }
    const interaction = interactions[i] ?? interactions[0] ?? "";
    if (interaction) {
      blocks.push({ id: `interaction-${i}`, kind: "interaction", text: interaction });
    }
  }
  if (!variantCount && sharedTags.length) {
    blocks.push({ id: "hashtags-0", kind: "hashtags", tags: sharedTags });
  }
  const cover = c.cover?.headline?.trim() || c.cover?.subline?.trim();
  if (cover || c.cover?.slides?.length) {
    const brief =
      [c.cover?.headline, c.cover?.subline].filter(Boolean).join(" · ") ||
      c.cover?.slides?.[0]?.description ||
      "按封面结构制作配图";
    blocks.push({ id: "coverBrief", kind: "coverBrief", text: brief });
  }
  return blocks;
}

export function manuscriptCopyAll(blocks: ManuscriptBlock[], titleIndex = 0): string {
  return buildManuscriptFlowText(resolveManuscriptVariant(blocks, titleIndex));
}

export function nextVersionLabel(versions: { label: string }[]): string {
  return `v${versions.length + 1}`;
}

export function blockStableKey(b: ManuscriptBlock): string {
  if (
    b.kind === "title" ||
    b.kind === "body" ||
    b.kind === "hashtags" ||
    b.kind === "interaction"
  ) {
    return `${b.kind}:${b.id}`;
  }
  return b.kind;
}

/** 对比两版 blocks，返回变更的 stable keys */
export function diffBlockKeys(prev: ManuscriptBlock[], next: ManuscriptBlock[]): Set<string> {
  const changed = new Set<string>();
  const prevMap = new Map(prev.map((b) => [blockStableKey(b), b]));
  for (const nb of next) {
    const key = blockStableKey(nb);
    const ob = prevMap.get(key);
    if (!ob) {
      changed.add(key);
      continue;
    }
    if (ob.kind !== nb.kind) {
      changed.add(key);
      continue;
    }
    if (ob.kind === "title" && nb.kind === "title" && ob.text !== nb.text) changed.add(key);
    if (ob.kind === "body" && nb.kind === "body" && ob.text !== nb.text) changed.add(key);
    if (ob.kind === "interaction" && nb.kind === "interaction" && ob.text !== nb.text) changed.add(key);
    if (ob.kind === "hashtags" && nb.kind === "hashtags") {
      if (ob.tags.join(",") !== nb.tags.join(",")) changed.add(key);
    }
    if (ob.kind === "coverBrief" && nb.kind === "coverBrief" && ob.text !== nb.text) changed.add(key);
  }
  return changed;
}

export function mergeBlocks(
  base: ManuscriptBlock[],
  proposed: ManuscriptBlock[],
  selectedKeys: Set<string>
): ManuscriptBlock[] {
  const propMap = new Map(proposed.map((b) => [blockStableKey(b), b]));
  const out: ManuscriptBlock[] = [];
  const used = new Set<string>();
  for (const b of base) {
    const key = blockStableKey(b);
    if (selectedKeys.has(key) && propMap.has(key)) {
      out.push(propMap.get(key)!);
      used.add(key);
    } else {
      out.push(b);
    }
  }
  for (const b of proposed) {
    const key = blockStableKey(b);
    if (selectedKeys.has(key) && !used.has(key)) {
      out.push(b);
      used.add(key);
    }
  }
  return out;
}
