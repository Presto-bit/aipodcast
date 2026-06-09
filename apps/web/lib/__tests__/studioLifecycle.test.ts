import { describe, expect, it } from "vitest";
import { deriveStudioLifecycle, normalizeStudioWorkLifecycle } from "../studioLifecycle";
import type { StudioWork } from "../studioWorkTypes";

const base = {
  id: "w1",
  channel: "xhs",
  title: "t",
  brief: "",
  binding: { notebook: "", noteIds: [] },
  featureCore: {},
  allowModelFallback: true,
  intake: {},
  versions: [],
  activeVersionId: "",
  shipChecks: {},
  agentTurns: [],
  createdAt: 0,
  updatedAt: 0
} as StudioWork;

describe("studioLifecycle", () => {
  it("derives empty for ready without versions", () => {
    expect(deriveStudioLifecycle({ ...base, status: "ready" })).toBe("empty");
  });

  it("normalizes zombie ready without versions to draft", () => {
    const next = normalizeStudioWorkLifecycle({ ...base, status: "ready" });
    expect(next.status).toBe("draft");
  });
});
