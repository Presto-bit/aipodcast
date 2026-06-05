import { routeStudioAction } from "../studioOrchestrator";
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
    schemaVersion: 3,
    ...overrides
  };
}

const turns = [
  { id: "u1", role: "user" as const, content: "写一篇产品新人清单体小红书", createdAt: 1 }
];

const autoGen = routeStudioAction(
  baseWork({ status: "draft", agentTurns: turns }),
  "写一篇产品新人清单体小红书",
  turns
);
assert(autoGen.tool === "generate", `draft+task should generate, got ${autoGen.tool}`);

const askOnly = routeStudioAction(
  baseWork({ status: "draft", agentTurns: turns }),
  "开头钩子怎么写更抓人？",
  turns
);
assert(askOnly.tool === "ask", `question-only should ask, got ${askOnly.tool}`);

const revise = routeStudioAction(
  baseWork({
    status: "ready",
    versions: [
      {
        id: "v1",
        label: "v1",
        createdAt: 1,
        blocks: [{ id: "b1", kind: "body", text: "正文" }]
      }
    ],
    activeVersionId: "v1"
  }),
  "把标题改得更犀利一点"
);
assert(revise.tool === "revise", `ready+revise intent should revise, got ${revise.tool}`);

console.log("studioOrchestrator.test.ts: ok");
