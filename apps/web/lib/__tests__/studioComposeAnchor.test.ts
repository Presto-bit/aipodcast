import { STUDIO_ACK_GENERATE, buildStudioTimeline } from "../studioTimeline";
import { appendStudioRun } from "../studioOrchestrator";
import type { StudioWork } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const userTurn = { id: "u1", role: "user" as const, content: "推广水杯", createdAt: 1 };
const ackTurn = {
  id: "ack-new",
  role: "assistant" as const,
  content: STUDIO_ACK_GENERATE,
  createdAt: 2
};

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
  anchorTurnId: ackTurn.id
});

assert(withRun.agentRuns?.[0]?.anchorTurnId === ackTurn.id, "run anchors to new ack turn");

const work: StudioWork = {
  ...withRun,
  agentTurns: [userTurn, ackTurn]
};

const items = buildStudioTimeline(work);
assert(items.length === 2, "turn group + running manuscript card");
assert(items[1]?.kind === "manuscript", "manuscript card present");
if (items[1]?.kind === "manuscript") {
  assert(items[1].run.id === runId, "running run linked");
  assert(items[1].run.status === "running", "run still running");
}

console.log("studioComposeAnchor.test.ts: ok");
