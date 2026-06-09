import { buildStudioTimeline } from "../studioTimeline";
import { appendStudioRun } from "../studioOrchestrator";
import type { StudioWork } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const userTurn = { id: "u1", role: "user" as const, content: "推广水杯", createdAt: 1 };

const base: StudioWork = {
  id: "w1",
  channel: "xhs",
  title: "测试",
  brief: "",
  status: "generating",
  binding: { notebook: "", noteIds: [] },
  featureCore: {} as StudioWork["featureCore"],
  allowModelFallback: true,
  intake: {},
  versions: [],
  activeVersionId: "",
  shipChecks: {},
  agentTurns: [userTurn],
  agentRuns: [],
  createdAt: 1,
  updatedAt: 1,
  schemaVersion: 4
};

const { work: withRun, runId } = appendStudioRun(base, "generate", "写稿中", "running", {
  anchorTurnId: userTurn.id
});

assert(withRun.agentRuns?.[0]?.anchorTurnId === userTurn.id, "run anchors to user turn");

const work: StudioWork = {
  ...withRun,
  agentTurns: [userTurn]
};

const items = buildStudioTimeline(work);
assert(items.length === 2, "user + running manuscript card");
assert(items[1]?.kind === "manuscript", "manuscript card present");
if (items[1]?.kind === "manuscript") {
  assert(items[1].run.id === runId, "running run linked");
  assert(items[1].run.status === "running", "run still running");
}

console.log("studioComposeAnchor.test.ts: ok");
