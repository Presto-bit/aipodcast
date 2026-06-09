import { describe, expect, it } from "vitest";
import {
  isStudioFirstDraftPatch,
  normalizePendingPatchForWork
} from "../studioPatchApply";
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
      blocks: [{ id: "b1", kind: "body", text: "旧正文" }]
    })),
    activeVersionId: count > 0 ? "v0" : ""
  } as StudioWork;
}

describe("isStudioFirstDraftPatch", () => {
  it("treats pending patch as first draft when no versions exist", () => {
    expect(isStudioFirstDraftPatch(workWithVersions(0), basePatch)).toBe(true);
  });

  it("treats pending patch as revision when versions exist", () => {
    const work = workWithVersions(1);
    expect(isStudioFirstDraftPatch(work, basePatch)).toBe(false);
    expect(isStudioFirstDraftPatch(work, { ...basePatch, fromVersionId: "v0" })).toBe(false);
  });
});

describe("normalizePendingPatchForWork", () => {
  it("fills fromVersionId and summary when revising with backend first-draft patch", () => {
    const work = workWithVersions(1);
    const normalized = normalizePendingPatchForWork(work, basePatch);
    expect(normalized.fromVersionId).toBe("v0");
    expect(normalized.summary).toBe("改版提议");
  });
});
