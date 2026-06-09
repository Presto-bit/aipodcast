import type { ManuscriptBlock } from "./studioWorkTypes";

/** 块级 diff key：title 单块；body 按段落序号 */
export function manuscriptDiffKey(block: ManuscriptBlock, indexInKind: number): string {
  if (block.kind === "title") return "title:0";
  if (block.kind === "body") return `body:p:${indexInKind}`;
  if (block.kind === "hashtags") return "meta:hashtags";
  if (block.kind === "interaction") return "meta:interaction";
  if (block.kind === "coverBrief") return "meta:coverBrief";
  return `block:${indexInKind}`;
}

function blockContentSig(block: ManuscriptBlock): string {
  if (block.kind === "hashtags") {
    return block.tags.join("|");
  }
  return block.text.trim();
}

function indexByKind(blocks: ManuscriptBlock[]): Map<string, ManuscriptBlock> {
  const titleIdx = { n: 0 };
  const bodyIdx = { n: 0 };
  const map = new Map<string, ManuscriptBlock>();
  for (const b of blocks) {
    const idx = b.kind === "title" ? titleIdx.n++ : b.kind === "body" ? bodyIdx.n++ : 0;
    map.set(manuscriptDiffKey(b, idx), b);
  }
  return map;
}

/** 对比 base / proposed，返回变更 key 列表 */
export function diffManuscriptChangedKeys(
  base: ManuscriptBlock[],
  proposed: ManuscriptBlock[]
): string[] {
  const baseMap = indexByKind(base);
  const proposedMap = indexByKind(proposed);
  const keys = new Set([...baseMap.keys(), ...proposedMap.keys()]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = baseMap.get(key);
    const b = proposedMap.get(key);
    if (!a || !b) {
      changed.push(key);
      continue;
    }
    if (blockContentSig(a) !== blockContentSig(b)) {
      changed.push(key);
    }
  }
  return changed.sort();
}

/** 按 scope 将 proposed 限制在允许变更的块（其余回退 base） */
export function maskProposedToScope(
  base: ManuscriptBlock[],
  proposed: ManuscriptBlock[],
  allowedKinds: Set<string>
): ManuscriptBlock[] {
  if (!base.length) return proposed;
  const proposedMap = indexByKind(proposed);
  const titleIdx = { n: 0 };
  return base.map((b) => {
    const idx = b.kind === "title" ? titleIdx.n++ : 0;
    const key = manuscriptDiffKey(b, idx);
    const kindAllowed =
      allowedKinds.has(b.kind) ||
      (b.kind === "title" && allowedKinds.has("title"));
    if (!kindAllowed) return b;
    return proposedMap.get(key) ?? b;
  });
}

export function inferPatchScopeFromMessage(message: string): Set<string> {
  const q = message.trim();
  const scopes = new Set<string>();
  if (/只改标题|改标题|标题改|别动正文|仅改标题/.test(q)) {
    scopes.add("title");
  }
  if (/只改正文|改正文|别动标题|第二段|段落/.test(q)) {
    scopes.add("body");
  }
  if (/话题|hashtag|标签/.test(q) && /改|换|优化/.test(q)) {
    scopes.add("hashtags");
  }
  if (/封面/.test(q) && /改|换/.test(q)) {
    scopes.add("coverBrief");
  }
  return scopes;
}
