import { describe, expect, it } from "vitest";
import { isStudioFirstDraftPatch } from "../studioPatchApply";
import type { PendingPatch, StudioWork } from "../studioWorkTypes";

const basePatch: PendingPatch = {
  fromVersionId: "",
  proposedBlocks: [{ id: "b1", kind: "body", text: "正文" }],
  summary: "首稿",
  changedKeys: ["body:p:0"]
};

function workWithVersions(count: number): StudioWork {
  return {
    versions: Array.from({ length: count }, (_, i) => ({
      id: `v${i}`,
      label: `v${i + 1}`,
      createdAt: i,
      blocks: []
    })),
    activeVersionId: count > 0 ? "v0" : ""
  } as StudioWork;
}

describe("isStudioFirstDraftPatch", () => {
  it("treats pending patch as first draft when no versions exist", () => {
    expect(isStudioFirstDraftPatch(workWithVersions(0), basePatch)).toBe(true);
  });

  it("treats pending patch as revision when base version exists", () => {
    const work = workWithVersions(1);
    const patch = { ...basePatch, fromVersionId: "v0", summary: "改版提议" };
    expect(isStudioFirstDraftPatch(work, patch)).toBe(false);
  });

  it("treats stale fromVersionId as first draft when no versions exist", () => {
    const patch = { ...basePatch, fromVersionId: "stale-id" };
    expect(isStudioFirstDraftPatch(workWithVersions(0), patch)).toBe(true);
  });
});
