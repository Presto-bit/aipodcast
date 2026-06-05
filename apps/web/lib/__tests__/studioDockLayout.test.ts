import { shouldShowStudioCanvas } from "../studioDockLayout";
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

assert(!shouldShowStudioCanvas(baseWork(), null), "empty draft hides canvas");
assert(
  shouldShowStudioCanvas(baseWork({ status: "generating" }), null),
  "generating shows canvas"
);
assert(
  shouldShowStudioCanvas(
    baseWork({ status: "ready" }),
    { id: "v1", label: "v1", createdAt: 1, blocks: [{ id: "b1", kind: "body", text: "x" }] }
  ),
  "ready with blocks shows canvas"
);

console.log("studioDockLayout.test.ts: ok");
