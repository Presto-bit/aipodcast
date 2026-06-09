import { describe, expect, it } from "vitest";
import { inferDomainFromText, parseDomainCorrection, mergeDomainContext } from "../studioDomainProfile";
import { parseStudioPlannerDecision, studioPlannerGhostLabelZh } from "../studioPlannerContract";
import { buildStudioEvidenceBar } from "../studioEvidenceBar";
import { classifyStudioFailure } from "../studioAgentFailure";
import { shouldAutoApplyPatch } from "../studioEditorMode";
import { looksLikeReviseRequest, buildLengthPatchOpinion } from "../studioReviseIntent";
import { diffLines } from "../studioLineDiff";
import { STUDIO_WORK_SCHEMA_VERSION, migrateStudioWorkToV3 } from "../studioWorkMigrate";
import type { StudioWork } from "../studioWorkTypes";

describe("studio V2", () => {
  it("infers domain from text", () => {
    expect(inferDomainFromText("写一篇 RAG 科普给产品经理").domain).toBe("article");
    expect(inferDomainFromText("推广水杯小红书笔记").domain).toBe("social");
  });

  it("parses domain correction", () => {
    expect(parseDomainCorrection("改成邮件语气")?.domain).toBe("business");
  });

  it("merges domain context", () => {
    const merged = mergeDomainContext({ domain: "social", format: "short_post" }, "改成科普长文");
    expect(merged.domain).toBe("article");
  });

  it("parses planner contract", () => {
    const d = parseStudioPlannerDecision({
      tool: "patch",
      reason: "用户要改标题",
      domain: "article"
    });
    expect(d?.tool).toBe("patch");
    expect(studioPlannerGhostLabelZh("patch")).toBe("编辑中…");
  });

  it("builds evidence bar", () => {
    const bar = buildStudioEvidenceBar({
      domain: "article",
      format: "tutorial",
      corpusCount: 2,
      taskSummary: "RAG 科普"
    });
    expect(bar).toContain("文章");
    expect(bar).toContain("资料 2");
  });

  it("classifies failures", () => {
    expect(classifyStudioFailure("network error").code).toBe("network");
    expect(classifyStudioFailure("", true).code).toBe("cancelled");
  });

  it("style revise intent", () => {
    expect(looksLikeReviseRequest("写的更小红书体一些", true)).toBe(true);
    expect(looksLikeReviseRequest("我想写一篇小红书推广", false)).toBe(false);
  });

  it("length constraint maps to patch opinion", () => {
    expect(looksLikeReviseRequest("写500字", true)).toBe(true);
    const opinion = buildLengthPatchOpinion("写500字");
    expect(opinion).toContain("500");
    expect(opinion).toContain("【块级改版】");
  });

  it("explore mode auto applies", () => {
    expect(shouldAutoApplyPatch("explore")).toBe(true);
    expect(shouldAutoApplyPatch("review")).toBe(false);
    expect(shouldAutoApplyPatch("explore", { forceReview: true })).toBe(false);
  });

  it("diff lines", () => {
    const hunks = diffLines("a\nb", "a\nc");
    expect(hunks.length).toBe(1);
    expect(hunks[0]?.after).toBe("c");
  });

  it("migrates to schema v6", () => {
    const work: StudioWork = {
      id: "w",
      channel: "xhs",
      title: "t",
      brief: "",
      status: "draft",
      schemaVersion: 5,
      binding: { notebook: "", noteIds: [] },
      featureCore: {} as StudioWork["featureCore"],
      allowModelFallback: true,
      intake: {},
      versions: [],
      activeVersionId: "",
      shipChecks: {},
      agentTurns: [],
      createdAt: 0,
      updatedAt: 0
    };
    const next = migrateStudioWorkToV3(work);
    expect(next.schemaVersion).toBe(STUDIO_WORK_SCHEMA_VERSION);
    expect(next.editorMode).toBe("explore");
    expect(next.domain).toBe("social");
  });
});
