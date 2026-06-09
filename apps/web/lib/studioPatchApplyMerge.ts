import type { ManuscriptBlock } from "./studioWorkTypes";

export function indexByKindForApply(blocks: ManuscriptBlock[]): Map<string, ManuscriptBlock> {
  const titleIdx = { n: 0 };
  const map = new Map<string, ManuscriptBlock>();
  for (const b of blocks) {
    const idx = b.kind === "title" ? titleIdx.n++ : 0;
    const key = b.kind === "title" ? `title:${idx}` : b.kind === "body" ? "body:p:0" : b.kind;
    map.set(key, b);
  }
  return map;
}
