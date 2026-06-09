import { describe, expect, it } from "vitest";
import {
  diffManuscriptChangedKeys,
  inferPatchScopeFromMessage,
  maskProposedToScope
} from "../studioPatchDiff";
import type { ManuscriptBlock } from "../studioWorkTypes";

describe("studioPatchDiff", () => {
  const base: ManuscriptBlock[] = [
    { id: "t1", kind: "title", text: "标题 A" },
    { id: "b1", kind: "body", text: "段落一\n\n段落二" },
    { id: "h1", kind: "hashtags", tags: ["职场"] }
  ];

  const proposed: ManuscriptBlock[] = [
    { id: "t1", kind: "title", text: "标题 B" },
    { id: "b1", kind: "body", text: "段落一\n\n段落二" },
    { id: "h1", kind: "hashtags", tags: ["职场"] }
  ];

  it("diffs title key as title:0", () => {
    const changed = diffManuscriptChangedKeys(base, proposed);
    expect(changed).toContain("title:0");
    expect(changed).not.toContain("body:p:0");
  });

  it("masks scope to title only", () => {
    const scoped = maskProposedToScope(base, proposed, inferPatchScopeFromMessage("只改标题"));
    const scopedChanged = diffManuscriptChangedKeys(base, scoped);
    expect(scopedChanged).toEqual(["title:0"]);
  });
});
