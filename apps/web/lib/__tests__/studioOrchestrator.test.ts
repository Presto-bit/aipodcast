import { describe, expect, it } from "vitest";
import { mergeBriefChipReply } from "../studioBriefMerge";
import { routeStudioAction } from "../studioOrchestrator";
import type { StudioWork } from "../studioWorkTypes";

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

describe("studioOrchestrator", () => {
  const turns = [
    { id: "u1", role: "user" as const, content: "写一篇产品新人清单体小红书", createdAt: 1 }
  ];

  it("routes promo brief to generate", () => {
    const promoMsg =
      "我想写一篇小红书推广文案，推广杯子，给职场人士提醒喝水";
    const promoTurns = [{ id: "u1", role: "user" as const, content: promoMsg, createdAt: 1 }];
    const autoGen = routeStudioAction(
      baseWork({ status: "draft", agentTurns: promoTurns }),
      promoMsg,
      promoTurns
    );
    expect(autoGen.tool).toBe("generate");
  });

  it("routes cup-only promo to generate (V2 no gate)", () => {
    const cupOnlyMsg = "我想写一篇小红书推广水杯";
    const cupTurns = [{ id: "u2", role: "user" as const, content: cupOnlyMsg, createdAt: 1 }];
    const cupClarify = routeStudioAction(
      baseWork({ status: "draft", agentTurns: cupTurns }),
      cupOnlyMsg,
      cupTurns
    );
    expect(cupClarify.tool).toBe("generate");
  });

  it("routes question-only to ask", () => {
    const askOnly = routeStudioAction(
      baseWork({ status: "draft", agentTurns: turns }),
      "开头钩子怎么写更抓人？",
      turns
    );
    expect(askOnly.tool).toBe("ask");
  });

  it("routes vague brief to generate (V2 zero-config)", () => {
    const vague = routeStudioAction(
      baseWork({ status: "draft", agentTurns: [{ id: "u1", role: "user", content: "帮我想想", createdAt: 1 }] }),
      "帮我想想",
      [{ id: "u1", role: "user" as const, content: "帮我想想", createdAt: 1 }]
    );
    expect(vague.tool).toBe("generate");
  });

  it("routes ready revise intent to revise", () => {
    const readyWork = baseWork({
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
    });
    const revise = routeStudioAction(readyWork, "把标题改得更犀利一点");
    expect(revise.tool).toBe("revise");
  });

  it("routes ready length constraint to revise", () => {
    const readyWork = baseWork({
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
    });
    const lengthEdit = routeStudioAction(readyWork, "写500字");
    expect(lengthEdit.tool).toBe("revise");
  });

  it("routes ready summary to ask", () => {
    const readyWork = baseWork({
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
    });
    const summary = routeStudioAction(readyWork, "总结一下这篇要点");
    expect(summary.tool).toBe("ask");
  });

  it("routes ready explicit question to ask", () => {
    const readyWork = baseWork({
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
    });
    const ask = routeStudioAction(readyWork, "这段为什么这样写？");
    expect(ask.tool).toBe("ask");
  });

  it("routes merged chip brief to generate", () => {
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
    expect(afterChip.tool).toBe("generate");
  });
});
