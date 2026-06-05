import { migrateStudioWorkToV3 } from "../studioWorkMigrate";
import type { StudioWork } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const legacy = {
  id: "w1",
  channel: "xhs",
  title: "旧任务",
  brief: "",
  status: "planned",
  binding: { notebook: "", noteIds: [] },
  featureCore: {} as StudioWork["featureCore"],
  allowModelFallback: true,
  intake: {},
  plan: { goal: "写稿", outline: [], materialLabels: [], materialCount: 0, voiceEnabled: false, voiceSummary: "", risks: [], inferenceSummary: [] },
  versions: [],
  activeVersionId: "",
  shipChecks: {},
  agentTurns: [],
  postDoneFollowUpPending: true,
  postDoneCoach: "解读",
  createdAt: 1,
  updatedAt: 1
} as StudioWork;

const migrated = migrateStudioWorkToV3(legacy);
assert(migrated.status === "draft", "planned -> draft");
assert(migrated.plan === undefined, "plan cleared");
assert(migrated.postDoneCoach === undefined, "postDone cleared");
assert(migrated.schemaVersion === 4, "schema v4");

const again = migrateStudioWorkToV3(migrated);
assert(again.schemaVersion === 4, "idempotent migrate keeps v4");

console.log("studioWorkMigrate.test.ts: ok");
