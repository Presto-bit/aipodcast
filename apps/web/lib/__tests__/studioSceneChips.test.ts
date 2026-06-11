import assert from "node:assert/strict";
import { applySceneChip, STUDIO_NEW_AGENT_SCENE_CHIPS } from "../studioSceneChips";
import type { StudioWork } from "../studioWorkTypes";

const baseWork: StudioWork = {
  id: "w1",
  channel: "xhs",
  title: "",
  brief: "",
  status: "draft",
  binding: { notebook: "", noteIds: [] },
  featureCore: { who: "", remember: "", avoid: "" },
  allowModelFallback: true,
  intake: {},
  versions: [],
  activeVersionId: "",
  shipChecks: {},
  agentTurns: [],
  updatedAt: 0,
  createdAt: 0
};

assert.equal(STUDIO_NEW_AGENT_SCENE_CHIPS.length, 2);

const science = STUDIO_NEW_AGENT_SCENE_CHIPS.find((c) => c.id === "science_article")!;
const next = applySceneChip(baseWork, science);
assert.equal(next.domain, "article");
assert.equal(next.format, "long_form");
assert.ok(next.brief.includes("科普"));

const withBrief = { ...baseWork, brief: "已有 brief" };
assert.equal(applySceneChip(withBrief, science).brief, "已有 brief");

console.log("studioSceneChips.test.ts ok");
