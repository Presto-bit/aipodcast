import { mergeBriefChipReply } from "../studioBriefMerge";
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

const promoMsg =
  "我想写一篇小红书推广文案，推广杯子，给职场人士提醒喝水";
const promoTurns = [{ id: "u1", role: "user" as const, content: promoMsg, createdAt: 1 }];
const autoGen = routeStudioAction(
  baseWork({ status: "draft", agentTurns: promoTurns }),
  promoMsg,
  promoTurns
);
assert(autoGen.tool === "generate", `promo brief should generate, got ${autoGen.tool}`);

const cupOnlyMsg = "我想写一篇小红书推广水杯";
const cupTurns = [{ id: "u2", role: "user" as const, content: cupOnlyMsg, createdAt: 1 }];
const cupClarify = routeStudioAction(
  baseWork({ status: "draft", agentTurns: cupTurns }),
  cupOnlyMsg,
  cupTurns
);
assert(cupClarify.tool === "generate", `cup-only promo should compose open-ended, got ${cupClarify.tool}`);

const askOnly = routeStudioAction(
  baseWork({ status: "draft", agentTurns: turns }),
  "开头钩子怎么写更抓人？",
  turns
);
assert(askOnly.tool === "ask", `question-only should ask, got ${askOnly.tool}`);

const vague = routeStudioAction(
  baseWork({ status: "draft", agentTurns: [{ id: "u1", role: "user", content: "帮我想想", createdAt: 1 }] }),
  "帮我想想",
  [{ id: "u1", role: "user" as const, content: "帮我想想", createdAt: 1 }]
);
assert(vague.tool === "ask", `vague brief should ask, got ${vague.tool}`);

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

const listTurns = [
  { id: "u1", role: "user" as const, content: "我想写一篇清单体内容", createdAt: 1 }
];
const mergedBrief = mergeBriefChipReply(listTurns[0]!.content, "受众：产品新人");
const mergedTurns = [
  ...listTurns,
  { id: "u2", role: "user" as const, content: mergedBrief, createdAt: 2 }
];
const afterChip = routeStudioAction(
  baseWork({ status: "draft", agentTurns: mergedTurns }),
  mergedBrief,
  mergedTurns
);
assert(afterChip.tool === "generate", `merged chip brief should generate, got ${afterChip.tool}`);

console.log("studioOrchestrator.test.ts: ok");
