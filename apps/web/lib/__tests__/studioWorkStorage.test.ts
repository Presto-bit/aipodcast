import assert from "node:assert/strict";
import test from "node:test";
import { isEmptyStudioWork } from "../studioWorkTask";
import type { StudioWork } from "../studioWorkTypes";

function baseWork(over: Partial<StudioWork> = {}): StudioWork {
  return {
    id: "w1",
    channel: "xhs",
    title: "新任务",
    brief: "",
    status: "draft",
    schemaVersion: 3,
    editorMode: "preview",
    domain: "general",
    format: "general",
    plannerAssumptions: [],
    binding: { notebook: "", noteIds: [] },
    featureCore: { who: "", remember: "", avoid: "" },
    allowModelFallback: true,
    intake: {},
    versions: [],
    activeVersionId: "",
    shipChecks: {},
    agentTurns: [],
    agentSessionState: null,
    agentRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...over
  };
}

test("isEmptyStudioWork rejects draft with corpus binding", () => {
  assert.equal(
    isEmptyStudioWork(baseWork({ binding: { notebook: "nb1", noteIds: ["n1"] } })),
    false
  );
});

test("isEmptyStudioWork rejects draft with user turns", () => {
  assert.equal(
    isEmptyStudioWork(
      baseWork({
        agentTurns: [{ id: "u1", role: "user", content: "写一篇", createdAt: 1 }]
      })
    ),
    false
  );
});

test("isEmptyStudioWork accepts blank draft", () => {
  assert.equal(isEmptyStudioWork(baseWork()), true);
});
