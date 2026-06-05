import type { ExpertDeliverable } from "./homeComposerExpertTypes";
import type { ManuscriptBlock } from "./studioWorkTypes";
import { xhsBodyPlainText } from "./xhsBodyFormat";

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
  const body = xhsBodyPlainText(c.body);
  const corpusEvidence =
    deliverable.meta?.provenance?.corpusCoverage === "full" ||
    deliverable.meta?.provenance?.corpusCoverage === "partial";
  if (body) {
    blocks.push({
      id: "body",
      kind: "body",
      text: body,
      evidence: corpusEvidence ? "corpus" : "model"
    });
  }
  const tags = (c.hashtags || []).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean);
  if (tags.length) blocks.push({ id: "hashtags", kind: "hashtags", tags });
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
  const titles = blocks.filter((b): b is Extract<ManuscriptBlock, { kind: "title" }> => b.kind === "title");
  const body = blocks.find((b) => b.kind === "body");
  const tags = blocks.find((b) => b.kind === "hashtags");
  const title = titles[titleIndex]?.text || titles[0]?.text || "";
  const bodyText = body && body.kind === "body" ? body.text : "";
  const tagLine =
    tags && tags.kind === "hashtags" ? tags.tags.map((t) => `#${t}`).join(" ") : "";
  return [title, bodyText, tagLine].filter(Boolean).join("\n\n");
}

export function nextVersionLabel(versions: { label: string }[]): string {
  return `v${versions.length + 1}`;
}

export function blockStableKey(b: ManuscriptBlock): string {
  return b.kind === "title" ? `${b.kind}:${b.id}` : b.kind;
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
