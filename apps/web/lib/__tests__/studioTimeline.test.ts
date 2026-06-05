import {
  STUDIO_ACK_GENERATE,
  buildStudioTimeline,
  resolveJobAnchorTurnId
} from "../studioTimeline";
import type { StudioWork } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ackId = "ack-1";
const work: StudioWork = {
  id: "w1",
  channel: "xhs",
  title: "测试",
  brief: "",
  status: "ready",
  binding: { notebook: "", noteIds: [] },
  featureCore: {} as StudioWork["featureCore"],
  allowModelFallback: true,
  intake: {},
  versions: [
    {
      id: "v1",
      label: "v1",
      createdAt: 2,
      blocks: [{ id: "b1", kind: "body", text: "正文" }],
      sourceRunId: "run-1"
    }
  ],
  activeVersionId: "v1",
  shipChecks: {},
  agentTurns: [
    { id: "u1", role: "user", content: "写推广", createdAt: 1 },
    { id: ackId, role: "assistant", content: STUDIO_ACK_GENERATE, createdAt: 2 }
  ],
  agentRuns: [
    {
      id: "run-1",
      tool: "generate",
      status: "done",
      summary: "完成",
      startedAt: 2,
      anchorTurnId: ackId
    }
  ],
  createdAt: 1,
  updatedAt: 1,
  schemaVersion: 4
};

assert(resolveJobAnchorTurnId(work.agentTurns, "generate") === ackId, "resolve ack");

const items = buildStudioTimeline(work);
assert(items.length === 2, "group + manuscript");
assert(items[0]?.kind === "turn-group", "first is dialogue");
assert(items[1]?.kind === "manuscript", "manuscript after ack group");
if (items[1]?.kind === "manuscript") {
  assert(items[1].version?.id === "v1", "version linked to run");
}

console.log("studioTimeline.test.ts: ok");
