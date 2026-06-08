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
assert(items.length === 3, "user + ack + manuscript");
assert(items[0]?.kind === "dialogue" && items[0].turn.role === "user", "first is user");
assert(items[1]?.kind === "dialogue" && items[1].ephemeral === true, "ack ephemeral");
assert(items[2]?.kind === "manuscript", "manuscript after ack");
if (items[2]?.kind === "manuscript") {
  assert(items[2].version?.id === "v1", "version linked to run");
}

const wrapWork: StudioWork = {
  ...work,
  agentTurns: [
    ...(work.agentTurns ?? []),
    {
      id: "wrap-1",
      role: "assistant",
      content: "写稿完成。切换方向可看三篇成稿。",
      intent: "compose_wrap_up",
      createdAt: 3
    }
  ]
};
const wrapItems = buildStudioTimeline(wrapWork);
assert(wrapItems.length === 4, "user + ack + manuscript + wrap-up");
assert(wrapItems[3]?.kind === "dialogue", "wrap-up in timeline order after manuscript");
if (wrapItems[3]?.kind === "dialogue") {
  assert(wrapItems[3].turn.intent === "compose_wrap_up", "wrap-up turn");
}

console.log("studioTimeline.test.ts: ok");
