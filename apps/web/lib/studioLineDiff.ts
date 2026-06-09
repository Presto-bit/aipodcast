/** Studio V2 — 行级 diff（patch 路径 Accept/Reject） */

export type LineDiffHunk = {
  key: string;
  lineIndex: number;
  before: string;
  after: string;
  kind: "add" | "remove" | "change" | "same";
};

export function diffLines(before: string, after: string, keyPrefix = "line"): LineDiffHunk[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const hunks: LineDiffHunk[] = [];
  for (let i = 0; i < max; i++) {
    const lineA = a[i] ?? "";
    const lineB = b[i] ?? "";
    if (lineA === lineB) continue;
    let kind: LineDiffHunk["kind"] = "change";
    if (!lineA && lineB) kind = "add";
    else if (lineA && !lineB) kind = "remove";
    hunks.push({
      key: `${keyPrefix}:${i}`,
      lineIndex: i,
      before: lineA,
      after: lineB,
      kind
    });
  }
  return hunks;
}

/** 合并行级 hunk 采纳结果 */
export function applyLineHunks(
  before: string,
  after: string,
  acceptedKeys: Set<string>,
  keyPrefix = "line"
): string {
  const hunks = diffLines(before, after, keyPrefix);
  if (!hunks.length) return after;
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const hunk = hunks.find((h) => h.lineIndex === i);
    if (hunk && acceptedKeys.has(hunk.key)) {
      out.push(hunk.after);
    } else if (hunk && !acceptedKeys.has(hunk.key)) {
      out.push(hunk.before);
    } else {
      out.push(b[i] ?? a[i] ?? "");
    }
  }
  return out.join("\n").replace(/\n+$/, "");
}
