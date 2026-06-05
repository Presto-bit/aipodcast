import {
  shouldShowStudioManuscriptSection,
  studioGeneratingUiMode
} from "../studioDockLayout";
import type { StudioWork } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function baseWork(overrides: Partial<StudioWork> = {}): StudioWork {
  return {
    id: "w1",
    channel: "xhs",
    title: "测试",
    brief: "",
    status: "draft",
    binding: { notebook: "", noteIds: [] },
    featureCore: {} as StudioWork["featureCore"],
    allowModelFallback: true,
    intake: {},
    versions: [],
    activeVersionId: "",
    shipChecks: {},
    agentTurns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

const version = {
  id: "v1",
  label: "v1",
  createdAt: 1,
  blocks: [{ id: "b1", kind: "body" as const, text: "x" }]
};

assert(!shouldShowStudioManuscriptSection(baseWork(), null), "empty draft hides manuscript");
assert(
  shouldShowStudioManuscriptSection(baseWork({ status: "generating" }), null),
  "generating shows manuscript progress section"
);
assert(
  shouldShowStudioManuscriptSection(baseWork({ status: "ready" }), version),
  "ready with blocks shows manuscript"
);
assert(studioGeneratingUiMode(baseWork({ status: "generating" }), null) === "progress", "first generate progress");
assert(
  studioGeneratingUiMode(baseWork({ status: "generating" }), version) === "hold-existing",
  "revise holds existing"
);

console.log("studioDockLayout.test.ts: ok");
