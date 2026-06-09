import { describe, expect, it } from "vitest";
import { studioSemanticPhase } from "../studioPhaseLabel";

describe("studioSemanticPhase", () => {
  it("humanizes prep phase without backend direction jargon", () => {
    const label = studioSemanticPhase({
      runPhase: "正在撰写标题与正文…",
      tool: "generate"
    });
    expect(label).not.toBe("正在写标题…");
    expect(label).toBe("正在撰写成稿…");
    expect(label).not.toMatch(/方向|三/);
  });

  it("shows stream output label when blocks arrive", () => {
    const label = studioSemanticPhase({
      runPhase: "正在撰写完整成稿…",
      tool: "generate",
      streamingBlocks: [{ id: "t1", kind: "title", text: "标题" }]
    });
    expect(label).toBe("正在输出成稿…");
  });
});
